import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";
import { openFixtureSetup, readFixtureOnboarding, simulateFixtureSetupMerge } from "./fixture-onboarding.ts";
import { acceptFixtureDelivery, setFixtureHead } from "./fixture-sync.ts";
import { closeRuntime, getAuth, getSession } from "./runtime.ts";
import { migrateAndSeed } from "./setup.ts";

const repositoryId = 1001;
const installationId = 2001;

describe.skipIf(process.env.NUTSHELL_VERIFY !== "1")("PostgreSQL fixture onboarding", () => {
  const first = randomBytes(20).toString("hex");
  const second = randomBytes(20).toString("hex");
  const testRevisions = new Set([first, second]);
  const testProposals: string[] = [];
  const testDeliveries: string[] = [];
  const sessionIds: string[] = [];
  const ownerInstructions = "# Field Notes owner instructions\r\n\r\nKeep this guidance intact.\r\n";
  const baseFiles = [{ path: "AGENTS.md", body: ownerInstructions }, { path: "README.md", body: "# Owner README\n" }];
  let db: pg.Pool;
  let origin: string;
  let originalHead: string | undefined;
  let originalCanWrite: boolean | undefined;

  beforeAll(async () => {
    const config = loadConfig();
    origin = config.origin;
    await migrateAndSeed(config.databaseUrl);
    db = new pg.Pool({ connectionString: config.databaseUrl });
    const { rows } = await db.query<{ head_revision: string }>("SELECT head_revision FROM fixture_state WHERE repository_id = $1", [repositoryId]);
    originalHead = rows[0]?.head_revision;
    await renewConnection();
  });

  afterAll(async () => {
    await closeRuntime();
    if (!db) return;
    try {
      const revisions = [...testRevisions];
      if (originalHead) {
        await db.query("UPDATE fixture_state SET head_revision = $1 WHERE repository_id = $2 AND head_revision = ANY($3)", [originalHead, repositoryId, revisions]);
      } else {
        await db.query("DELETE FROM fixture_state WHERE repository_id = $1 AND head_revision = ANY($2)", [repositoryId, revisions]);
      }
      await db.query("DELETE FROM fixture_delivery WHERE id = ANY($1)", [testDeliveries]);
      await db.query("DELETE FROM fixture_setup_proposal WHERE id = ANY($1)", [testProposals]);
      await db.query("DELETE FROM fixture_tree WHERE repository_id = $1 AND revision = ANY($2)", [repositoryId, revisions]);
      await db.query("DELETE FROM auth_session WHERE id = ANY($1)", [sessionIds]);
      if (originalCanWrite !== undefined) {
        await db.query("UPDATE local_provider_grant SET can_write = $1 WHERE repository_id = $2 AND user_id = 'local-reader'", [originalCanWrite, repositoryId]);
      }
    } finally {
      await db.end();
    }
  });

  async function renewConnection() {
    await db.query("UPDATE provider_installation SET active = false WHERE id = $1", [installationId]);
    await db.query("UPDATE provider_installation SET active = true WHERE id = $1", [installationId]);
  }

  async function login(persona: "coordinator" | "reader") {
    const response = await getAuth().handler(new Request(origin + "/api/auth/nutshell/persona", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ persona }),
    }));
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find((value) => value.includes("session_token="));
    expect(cookie).toBeDefined();
    const headers = new Headers({ Cookie: cookie!.split(";", 1)[0]! });
    const sessionId = (await getSession(headers))?.session.id;
    if (sessionId) sessionIds.push(sessionId);
    return headers;
  }

  it("requires configuration authority and refreshes a stale base without creating a second proposal", async () => {
    const owner = await login("coordinator");
    const writer = await login("reader");
    const id = String(repositoryId);
    const { rows } = await db.query<{ can_write: boolean }>("SELECT can_write FROM local_provider_grant WHERE repository_id = $1 AND user_id = 'local-reader'", [repositoryId]);
    originalCanWrite = rows[0]?.can_write;
    await db.query("UPDATE local_provider_grant SET can_write = true WHERE repository_id = $1 AND user_id = 'local-reader'", [repositoryId]);
    expect(await readFixtureOnboarding(writer, id)).toMatchObject({ canConfigure: false });
    expect(await openFixtureSetup(writer, id)).toEqual({ status: "forbidden" });

    await setFixtureHead(repositoryId, first, baseFiles);
    const [opened, repeated] = await Promise.all([openFixtureSetup(owner, id), openFixtureSetup(owner, id)]);
    expect(repeated).toEqual(opened);
    if (!("proposal" in opened)) throw new Error("Expected an open fixture proposal.");
    const proposal = opened.proposal;
    testProposals.push(proposal.id);
    testRevisions.add(proposal.headRevision);
    expect(proposal).toMatchObject({ provider: "fixture", status: "open", baseRevision: first });

    const updatedBase = [...baseFiles, { path: "src/owner.ts", body: "// Owner file\n" }];
    await setFixtureHead(repositoryId, second, updatedBase);
    expect(await simulateFixtureSetupMerge(owner, id, proposal.headRevision)).toEqual({ status: "conflict" });
    const refreshed = await openFixtureSetup(owner, id);
    if (!("proposal" in refreshed)) throw new Error("Expected refreshed fixture proposal.");
    testRevisions.add(refreshed.proposal.headRevision);
    expect(refreshed.proposal).toMatchObject({ id: proposal.id, baseRevision: second, status: "open" });
    expect(refreshed.proposal.headRevision).not.toBe(proposal.headRevision);
    expect(await simulateFixtureSetupMerge(writer, id, refreshed.proposal.headRevision)).toEqual({ status: "forbidden" });

    const [merged, retry] = await Promise.all([
      simulateFixtureSetupMerge(owner, id, refreshed.proposal.headRevision),
      simulateFixtureSetupMerge(owner, id, refreshed.proposal.headRevision),
    ]);
    expect(retry).toEqual(merged);
    if (!("delivery" in merged)) throw new Error("Expected a committed fixture merge.");
    testDeliveries.push(merged.delivery.deliveryId);
    testRevisions.add(merged.delivery.revision);
    const mergedTree = await db.query<{ files: { path: string; body: string }[] }>(
      "SELECT tree.files FROM fixture_state AS state JOIN fixture_tree AS tree ON tree.repository_id = state.repository_id AND tree.revision = state.head_revision WHERE state.repository_id = $1 AND state.head_revision = $2", [repositoryId, merged.delivery.revision],
    );
    const files = new Map(mergedTree.rows[0]?.files.map(({ path, body }) => [path, body]));
    expect(files.get("AGENTS.md")).toMatch(/^# Field Notes owner instructions\r\n\r\nKeep this guidance intact\.\r\n/u);
    expect(files.get("README.md")).toBe(baseFiles[1]?.body);
    expect(files.get("src/owner.ts")).toBe("// Owner file\n");

    await renewConnection();
    expect(await readFixtureOnboarding(owner, id)).toEqual({ canConfigure: true, configured: true, proposal: null });
    expect(await simulateFixtureSetupMerge(owner, id, refreshed.proposal.headRevision)).toEqual({ status: "conflict" });
    expect(await openFixtureSetup(owner, id)).toEqual({ status: "conflict" });
    expect(await acceptFixtureDelivery(merged.delivery)).toBe("unavailable");

    await setFixtureHead(repositoryId, second, updatedBase);
    const reopened = await openFixtureSetup(owner, id);
    if (!("proposal" in reopened)) throw new Error("Expected an open fixture proposal in the new connection.");
    testProposals.push(reopened.proposal.id);
    const remerged = await simulateFixtureSetupMerge(owner, id, reopened.proposal.headRevision);
    if (!("delivery" in remerged)) throw new Error("Expected a merged fixture proposal in the new connection.");
    testDeliveries.push(remerged.delivery.deliveryId);
    testRevisions.add(remerged.delivery.revision);
    expect(remerged.delivery.revision).toBe(merged.delivery.revision);
    expect(await acceptFixtureDelivery({ ...remerged.delivery, revision: reopened.proposal.headRevision })).toBe("unavailable");
    expect(await acceptFixtureDelivery(remerged.delivery)).toBe("accepted");
    expect(await acceptFixtureDelivery(remerged.delivery)).toBe("duplicate");
  }, 15_000);
});
