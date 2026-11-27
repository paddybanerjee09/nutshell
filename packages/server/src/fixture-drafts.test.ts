import { createHash, randomBytes, randomUUID } from "node:crypto";
import { buildFixtureSetupTree } from "@nutshell/core/fixture-setup-tree";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";
import { canEditFixtureMarkdown, maxFixtureDraftBytes, readFixtureDraft, saveFixtureDraft } from "./fixture-drafts.ts";
import { acceptFixtureDelivery, processNextFixtureDelivery, setFixtureHead } from "./fixture-sync.ts";
import { closeRuntime, getAuth, getSession } from "./runtime.ts";
import { migrateAndSeed } from "./setup.ts";

const repositoryId = 1001;
const repositoryKey = String(repositoryId);
const installationId = 2001;
const path = "nutshell-vault/features/nutshell-setup/CONTEXT.md";

describe.skipIf(process.env.NUTSHELL_VERIFY !== "1")("PostgreSQL private Markdown drafts", () => {
  const [revision, invalidRevision, newerRevision] = Array.from({ length: 3 }, () => randomBytes(20).toString("hex")) as [string, string, string];
  const revisions = [revision, invalidRevision, newerRevision];
  const delivered: string[] = [];
  const sessions: string[] = [];
  const tree = buildFixtureSetupTree([], { name: "Field Notes", description: "A synthetic draft test fixture.", entityId: "ent_draft_test" });
  const source = tree.find((file) => file.path === path)!.body;
  const originalStateQuery = "SELECT head_revision, indexed_revision, indexed_epoch, indexed_schema_version, indexed_policy_version FROM fixture_state WHERE repository_id = $1";
  type RepositoryState = {
    head_revision: string; indexed_revision: string | null; indexed_epoch: number | null;
    indexed_schema_version: number | null; indexed_policy_version: number | null;
  };
  let originalState: RepositoryState | undefined;
  let originalCanWrite: boolean | undefined;
  let db: pg.Pool;
  let origin: string;

  beforeAll(async () => {
    const config = loadConfig();
    origin = config.origin;
    await migrateAndSeed(config.databaseUrl);
    db = new pg.Pool({ connectionString: config.databaseUrl });
    originalState = (await db.query<RepositoryState>(originalStateQuery, [repositoryId])).rows[0];
    originalCanWrite = (await db.query<{ can_write: boolean }>(
      "SELECT can_write FROM local_provider_grant WHERE repository_id = $1 AND user_id = 'local-reader'", [repositoryId],
    )).rows[0]?.can_write;
  });

  afterAll(async () => {
    await closeRuntime();
    if (!db) return;
    try {
      if (originalState) {
        await db.query(`UPDATE fixture_state SET head_revision = $1, indexed_revision = $2, indexed_epoch = $3,
          indexed_schema_version = $4, indexed_policy_version = $5 WHERE repository_id = $6 AND head_revision = ANY($7)`, [
          originalState.head_revision, originalState.indexed_revision, originalState.indexed_epoch, originalState.indexed_schema_version,
          originalState.indexed_policy_version, repositoryId, revisions,
        ]);
      } else {
        await db.query("DELETE FROM fixture_state WHERE repository_id = $1 AND head_revision = ANY($2)", [repositoryId, revisions]);
      }
      await db.query("DELETE FROM markdown_draft WHERE repository_id = $1 AND source_revision = ANY($2)", [repositoryId, revisions]);
      await db.query("DELETE FROM fixture_delivery WHERE id = ANY($1)", [delivered]);
      await db.query("DELETE FROM fixture_tree WHERE repository_id = $1 AND revision = ANY($2)", [repositoryId, revisions]);
      await db.query("DELETE FROM auth_session WHERE id = ANY($1)", [sessions]);
      if (originalCanWrite !== undefined) await setReaderWrite(originalCanWrite);
    } finally {
      await db.end();
    }
  });

  async function login(persona: "coordinator" | "reader" | "other") {
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

  async function indexRevision(sha: string, files: typeof tree) {
    await setFixtureHead(repositoryId, sha, files);
    const deliveryId = randomUUID();
    delivered.push(deliveryId);
    expect(await acceptFixtureDelivery({ deliveryId, repositoryId, installationId, revision: sha })).toBe("accepted");
    while (await processNextFixtureDelivery()) {
      // The verify database has no running worker during this test.
    }
  }

  async function setReaderWrite(canWrite: boolean) {
    await db.query("UPDATE local_provider_grant SET can_write = $1 WHERE repository_id = $2 AND user_id = 'local-reader'", [canWrite, repositoryId]);
  }

  it("uses exact source and row versions, preserves Unicode Markdown and isolates drafts by writer and epoch", async () => {
    const owner = await login("coordinator");
    const otherSession = await login("coordinator");
    const reader = await login("reader");
    const outsider = await login("other");
    await setReaderWrite(false);
    await indexRevision(revision, tree);
    expect(await canEditFixtureMarkdown(owner, repositoryKey)).toBe(true);
    expect(await canEditFixtureMarkdown(reader, repositoryKey)).toBe(false);
    expect(await readFixtureDraft(new Headers(), repositoryKey, path)).toEqual({ status: "unavailable" });
    expect(await readFixtureDraft(outsider, repositoryKey, path)).toEqual({ status: "unavailable" });
    expect(await readFixtureDraft(reader, repositoryKey, path)).toEqual({ status: "forbidden" });
    expect(await readFixtureDraft(owner, repositoryKey, path)).toEqual({ status: "ready", source, sourceRevision: revision, draft: null });
    expect(await readFixtureDraft(owner, repositoryKey, "nutshell-vault/rogue.md")).toEqual({ status: "unavailable" });
    expect(await readFixtureDraft(owner, repositoryKey, "nutshell-vault/archive/old.md")).toEqual({ status: "invalid" });

    const input = { path, sourceRevision: revision, version: 0, markdown: "---\r\nname: 検証😀\r\n---\r\n\r\n**[[Context]]**  \r\n" };
    expect(await saveFixtureDraft(owner, repositoryKey, { ...input, markdown: "漢".repeat(maxFixtureDraftBytes / 2) })).toEqual({ status: "invalid" });
    const attempts = await Promise.all([
      saveFixtureDraft(owner, repositoryKey, input), saveFixtureDraft(otherSession, repositoryKey, { ...input, markdown: input.markdown + "e\u0301" }),
    ]);
    const saved = attempts.find((value) => value.status === "saved");
    if (!saved) throw new Error("Expected exactly one initial draft save.");
    expect(attempts.find((value) => value.status === "conflict")).toMatchObject({ reason: "version", draft: saved.draft });
    expect(saved.draft).toMatchObject({ sourceRevision: revision, version: 1, sourceBlob: createHash("sha256").update(source).digest("hex") });
    expect([input.markdown, input.markdown + "e\u0301"]).toContain(saved.draft.markdown);
    const updated = await saveFixtureDraft(owner, repositoryKey, { ...input, version: 1 });
    expect(updated).toMatchObject({ status: "saved", draft: { markdown: input.markdown, version: 2 } });
    expect(await readFixtureDraft(otherSession, repositoryKey, path)).toMatchObject({ status: "ready", source, draft: { markdown: input.markdown, version: 2 } });

    await setReaderWrite(true);
    expect(await canEditFixtureMarkdown(reader, repositoryKey)).toBe(true);
    expect(await readFixtureDraft(reader, repositoryKey, path)).toMatchObject({ status: "ready", draft: null });
    expect(await saveFixtureDraft(reader, repositoryKey, { ...input, markdown: "Private second writer." })).toMatchObject({ status: "saved", draft: { version: 1 } });
    await setReaderWrite(false);
    expect(await readFixtureDraft(reader, repositoryKey, path)).toEqual({ status: "forbidden" });

    await indexRevision(invalidRevision, [{ path: ".nutshell/config.json", body: "{" }]);
    expect(await canEditFixtureMarkdown(owner, repositoryKey)).toBe(true);
    const invalidBase = { status: "conflict", reason: "source", currentRevision: invalidRevision, draft: { markdown: input.markdown, version: 2 } };
    expect(await readFixtureDraft(owner, repositoryKey, path)).toMatchObject(invalidBase);
    expect(await saveFixtureDraft(owner, repositoryKey, { ...input, version: 2, markdown: "Keep this newer unsaved edit." })).toMatchObject(invalidBase);

    await indexRevision(newerRevision, tree);
    expect(await saveFixtureDraft(owner, repositoryKey, { ...input, sourceRevision: newerRevision, version: 2 })).toMatchObject({
      status: "conflict", reason: "source", currentRevision: newerRevision, draft: { markdown: input.markdown, version: 2 },
    });
    await db.query("UPDATE provider_installation SET active = false WHERE id = $1", [installationId]);
    try {
      expect(await readFixtureDraft(owner, repositoryKey, path)).toEqual({ status: "unavailable" });
    } finally {
      await db.query("UPDATE provider_installation SET active = true WHERE id = $1", [installationId]);
    }
    await indexRevision(newerRevision, tree);
    expect(await readFixtureDraft(owner, repositoryKey, path)).toMatchObject({ status: "ready", sourceRevision: newerRevision, draft: null });
    expect((await db.query("SELECT markdown FROM markdown_draft WHERE repository_id = $1 AND source_revision = $2 AND user_id = 'local-coordinator'", [repositoryId, revision])).rows)
      .toEqual([{ markdown: input.markdown }]);
  }, 20_000);
});
