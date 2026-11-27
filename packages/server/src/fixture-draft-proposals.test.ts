import { randomBytes, randomUUID } from "node:crypto";
import { buildFixtureSetupTree } from "@nutshell/core/fixture-setup-tree";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";
import { mergeFixtureDraftProposal, proposeFixtureDraft, readFixtureDraftProposal } from "./fixture-draft-proposals.ts";
import { readFixtureDraft, saveFixtureDraft } from "./fixture-drafts.ts";
import { preserveFixtureTestHistory } from "./fixture-history-test-support.ts";
import { acceptFixtureDelivery, processNextFixtureDelivery, readFixtureSnapshot, setFixtureHead, type FixtureFile } from "./fixture-sync.ts";
import { closeRuntime, getAuth, getSession } from "./runtime.ts";
import { migrateAndSeed } from "./setup.ts";

const repositoryId = 1001;
const repositoryKey = String(repositoryId);
const installationId = 2001;

describe.skipIf(process.env.NUTSHELL_VERIFY !== "1")("PostgreSQL fixture draft proposals", { timeout: 30_000 }, () => {
  const baseRevision = randomBytes(20).toString("hex");
  const staleRevision = randomBytes(20).toString("hex");
  const path = `nutshell-vault/features/draft-proposal-${baseRevision}.md`;
  const exactPath = `nutshell-vault/features/draft-exact-${baseRevision}.md`;
  const revisions = new Set([baseRevision, staleRevision]);
  const proposals: string[] = [];
  const deliveries: string[] = [];
  const sessions: string[] = [];
  const source = (id: string) => ["---", `id: ${id}`, "date: 2026-11-27", "status: active", "tags: [draft]", "---", "",
    "## Context", "", "Owner source.", "", "## Decision", "", "Preserve the rest of the tree.", "",
    "## Consequences", "", "Only this note changes.", "", "## Affected files", "", "None.", ""].join("\r\n");
  const original = source("fixture-proposal-note");
  const exactOriginal = source("fixture-exact-note");
  let tree = buildFixtureSetupTree([
    { path, body: original }, { path: exactPath, body: exactOriginal }, { path: "src/owner.ts", body: "// Odd whitespace  \r\nconst name = 'é';\n" },
  ], { name: "Field Notes", description: "Private proposal verification fixture.", entityId: "ent_proposal_test" });

  let db: pg.Pool;
  let origin: string;
  let originalState: Record<string, unknown> | undefined;
  let originalCanWrite: boolean | undefined;

  beforeAll(async () => {
    const config = loadConfig();
    origin = config.origin;
    await migrateAndSeed(config.databaseUrl);
    db = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 15_000 });
    tree = await preserveFixtureTestHistory(db, repositoryId, tree);
    originalState = (await db.query("SELECT * FROM fixture_state WHERE repository_id = $1", [repositoryId])).rows[0];
    originalCanWrite = (await db.query<{ can_write: boolean }>(
      "SELECT can_write FROM local_provider_grant WHERE repository_id = $1 AND user_id = 'local-reader'", [repositoryId],
    )).rows[0]?.can_write;
  }, 20_000);

  afterAll(async () => {
    await closeRuntime();
    if (!db) return;
    try {
      const scoped = [repositoryId, [...revisions]];
      if (originalState) {
        await db.query(`UPDATE fixture_state SET head_revision = $3, indexed_revision = $4, indexed_epoch = $5,
          indexed_schema_version = $6, indexed_policy_version = $7 WHERE repository_id = $1 AND head_revision = ANY($2)`, [
          ...scoped, originalState.head_revision, originalState.indexed_revision, originalState.indexed_epoch,
          originalState.indexed_schema_version, originalState.indexed_policy_version,
        ]);
      } else {
        await db.query("DELETE FROM fixture_state WHERE repository_id = $1 AND head_revision = ANY($2)", scoped);
      }
      await db.query("DELETE FROM markdown_draft WHERE repository_id = $1 AND source_revision = ANY($2)", scoped);
      await db.query("DELETE FROM fixture_draft_proposal WHERE id = ANY($1)", [proposals]);
      await db.query("DELETE FROM fixture_delivery WHERE id = ANY($1)", [deliveries]);
      await db.query("DELETE FROM fixture_tree WHERE repository_id = $1 AND revision = ANY($2)", scoped);
      await db.query("DELETE FROM auth_session WHERE id = ANY($1)", [sessions]);
      if (originalCanWrite !== undefined) await setReaderWrite(originalCanWrite);
    } finally {
      await db.end();
    }
  }, 20_000);

  async function login(persona: "coordinator" | "reader") {
    const response = await getAuth().handler(new Request(origin + "/api/auth/nutshell/persona", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ persona }),
    }));
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find((value) => value.includes("session_token="));
    const headers = new Headers({ Cookie: cookie!.split(";", 1)[0]! });
    const sessionId = (await getSession(headers))?.session.id;
    if (sessionId) sessions.push(sessionId);
    return headers;
  }

  async function setReaderWrite(canWrite: boolean) {
    await db.query("UPDATE local_provider_grant SET can_write = $1 WHERE repository_id = $2 AND user_id = 'local-reader'", [canWrite, repositoryId]);
  }

  async function processReceipts() {
    while (await processNextFixtureDelivery()) {
      // The verification database has no running worker during this test.
    }
  }

  async function storedTree(revision: string) {
    const { rows } = await db.query<{ files: FixtureFile[] }>("SELECT files FROM fixture_tree WHERE repository_id = $1 AND revision = $2", [repositoryId, revision]);
    return rows[0]?.files;
  }

  it("checks one file, requires the exact branch head and base, and keeps later private edits through durable receipt processing", async () => {
    const owner = await login("coordinator");
    const reader = await login("reader");
    await setReaderWrite(false);
    await setFixtureHead(repositoryId, baseRevision, tree);
    const seed = randomUUID();
    deliveries.push(seed);
    expect(await acceptFixtureDelivery({ deliveryId: seed, repositoryId, installationId, revision: baseRevision })).toBe("accepted");
    await processReceipts();
    expect(await readFixtureDraftProposal(reader, repositoryKey, path)).toEqual({ status: "forbidden" });
    expect(await proposeFixtureDraft(reader, repositoryKey, { path, version: 1 })).toEqual({ status: "forbidden" });

    const save = { path, sourceRevision: baseRevision, version: 0, markdown: "## Incomplete frontmatter" };
    expect(await saveFixtureDraft(owner, repositoryKey, save)).toMatchObject({ status: "saved", draft: { version: 1 } });
    expect(await proposeFixtureDraft(owner, repositoryKey, { path, version: 1 })).toMatchObject({ status: "invalid_candidate" });
    expect(await readFixtureDraftProposal(owner, repositoryKey, path)).toEqual({ status: "ready", proposal: null });

    const firstMarkdown = original.replace("Owner source.", "Proposed line 😀  ");
    expect(await saveFixtureDraft(owner, repositoryKey, { ...save, markdown: firstMarkdown, version: 1 })).toMatchObject({ status: "saved", draft: { version: 2 } });
    const [opened, retry] = await Promise.all([proposeFixtureDraft(owner, repositoryKey, { path, version: 2 }), proposeFixtureDraft(owner, repositoryKey, { path, version: 2 })]);
    if (opened.status !== "open") throw new Error("Expected an open fixture draft proposal.");
    proposals.push(opened.proposal.id);
    revisions.add(opened.proposal.headRevision);
    expect(retry).toEqual(opened);
    expect(opened.proposal).toMatchObject({ baseRevision, draftVersion: 2, branch: `nutshell/draft-${opened.proposal.id}`, provider: "fixture" });
    expect(await readFixtureSnapshot(owner, repositoryKey)).toMatchObject({ headRevision: baseRevision, revision: baseRevision });
    expect(await storedTree(opened.proposal.headRevision)).toEqual(tree.map((file) => file.path === path ? { path, body: firstMarkdown } : file));

    const checkedMarkdown = original.replace("Owner source.", "Checked line 検証😀  ");
    expect(await saveFixtureDraft(owner, repositoryKey, { ...save, markdown: checkedMarkdown, version: 2 })).toMatchObject({ status: "saved", draft: { version: 3 } });
    expect(await proposeFixtureDraft(owner, repositoryKey, { path, version: 2 })).toMatchObject({ status: "conflict", reason: "version", draft: { markdown: checkedMarkdown, version: 3 } });
    expect(await proposeFixtureDraft(owner, repositoryKey, { path, version: 3 })).toMatchObject({ status: "conflict", reason: "head", proposal: opened.proposal });
    const updated = await proposeFixtureDraft(owner, repositoryKey, { path, version: 3, expectedHead: opened.proposal.headRevision });
    if (updated.status !== "open") throw new Error("Expected an updated draft proposal.");
    revisions.add(updated.proposal.headRevision);
    expect(updated.proposal).toMatchObject({ id: opened.proposal.id, branch: opened.proposal.branch, draftVersion: 3 });
    expect(updated.proposal.headRevision).not.toBe(opened.proposal.headRevision);
    expect(await proposeFixtureDraft(owner, repositoryKey, { path, version: 3, expectedHead: opened.proposal.headRevision })).toEqual(updated);

    const expectedMerge = { path, proposalId: updated.proposal.id, expectedHead: updated.proposal.headRevision };
    expect(await mergeFixtureDraftProposal(owner, repositoryKey, { ...expectedMerge, expectedHead: opened.proposal.headRevision })).toMatchObject({ status: "conflict", reason: "head" });
    await setReaderWrite(true);
    expect(await readFixtureDraftProposal(reader, repositoryKey, path)).toEqual({ status: "ready", proposal: null });
    expect(await mergeFixtureDraftProposal(reader, repositoryKey, expectedMerge)).toEqual({ status: "unavailable" });
    await setReaderWrite(false);

    await setFixtureHead(repositoryId, staleRevision, tree);
    expect(await mergeFixtureDraftProposal(owner, repositoryKey, expectedMerge)).toMatchObject({ status: "conflict", reason: "source", currentRevision: staleRevision });
    await setFixtureHead(repositoryId, baseRevision, tree);
    const later = "Private text saved after the checked proposal.";
    expect(await saveFixtureDraft(owner, repositoryKey, { ...save, markdown: later, version: 3 })).toMatchObject({ status: "saved", draft: { version: 4 } });
    const merged = await mergeFixtureDraftProposal(owner, repositoryKey, expectedMerge);
    if (merged.status !== "merged") throw new Error("Expected the checked proposal to merge.");
    revisions.add(merged.delivery.revision);
    deliveries.push(merged.delivery.deliveryId);
    expect(await mergeFixtureDraftProposal(owner, repositoryKey, expectedMerge)).toEqual(merged);
    expect(await storedTree(merged.delivery.revision)).toEqual(tree.map((file) => file.path === path ? { path, body: checkedMarkdown } : file));
    expect(await readFixtureSnapshot(owner, repositoryKey)).toMatchObject({ headRevision: merged.delivery.revision, revision: baseRevision });
    expect(await acceptFixtureDelivery({ ...merged.delivery, revision: updated.proposal.headRevision })).toBe("unavailable");
    expect(await acceptFixtureDelivery(merged.delivery)).toBe("accepted");
    expect(await acceptFixtureDelivery(merged.delivery)).toBe("duplicate");
    await processReceipts();
    expect(await readFixtureSnapshot(owner, repositoryKey)).toMatchObject({ status: "current", revision: merged.delivery.revision });
    expect(await readFixtureDraft(owner, repositoryKey, path)).toMatchObject({ status: "conflict", reason: "source", draft: { markdown: later, version: 4 } });

    expect(await saveFixtureDraft(owner, repositoryKey, { ...save, path: exactPath, sourceRevision: merged.delivery.revision,
      markdown: exactOriginal.replace("Owner source.", "Exact saved version.") })).toMatchObject({ status: "saved", draft: { version: 1 } });
    const exact = await proposeFixtureDraft(owner, repositoryKey, { path: exactPath, version: 1 });
    if (exact.status !== "open") throw new Error("Expected a proposal for the exact draft version.");
    proposals.push(exact.proposal.id);
    revisions.add(exact.proposal.headRevision);
    const exactMerge = { path: exactPath, proposalId: exact.proposal.id, expectedHead: exact.proposal.headRevision };
    const final = await mergeFixtureDraftProposal(owner, repositoryKey, exactMerge);
    if (final.status !== "merged") throw new Error("Expected the exact draft version to merge.");
    revisions.add(final.delivery.revision);
    deliveries.push(final.delivery.deliveryId);
    expect(await readFixtureDraft(owner, repositoryKey, exactPath)).toMatchObject({ status: "conflict", reason: "source", draft: null });

    await db.query("UPDATE provider_installation SET active = false WHERE id = $1", [installationId]);
    await db.query("UPDATE provider_installation SET active = true WHERE id = $1", [installationId]);
    expect(await mergeFixtureDraftProposal(owner, repositoryKey, exactMerge)).toEqual({ status: "unavailable" });
    expect(await acceptFixtureDelivery(final.delivery)).toBe("unavailable");
  });
});
