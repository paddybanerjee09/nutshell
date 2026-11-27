import { randomBytes, randomUUID } from "node:crypto";
import { buildFixtureSetupTree } from "@nutshell/core/fixture-setup-tree";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";
import { preserveFixtureTestHistory } from "./fixture-history-test-support.ts";
import { acceptFixtureDelivery, processNextFixtureDelivery, setFixtureHead } from "./fixture-sync.ts";
import { closeRuntime, getAuth, getSession } from "./runtime.ts";
import { migrateAndSeed } from "./setup.ts";
import { createTeamTask, createTeamTaskSchema, deleteTeamTask, listTeamTasks, updateTeamTask } from "./team-tasks.ts";

const repositoryId = 1001;
const repositoryKey = String(repositoryId);
const installationId = 2001;

it("validates date-only input, bounded distinct references, and caller-supplied identity fields", () => {
  expect(createTeamTaskSchema.safeParse({ title: "Check release", deadline: "2028-02-29" }).success).toBe(true);
  for (const value of [
    { deadline: "2027-02-29" }, { deadline: "2026-11-27T00:00:00Z" }, { deadline: "0000-01-01" },
    { issueNumbers: [1, 1] }, { pullRequestNumbers: ["https://example.com/repo/pull/1"] }, { creatorId: "local-coordinator" },
  ]) expect(createTeamTaskSchema.safeParse({ title: "Check release", ...value }).success).toBe(false);
});

describe.skipIf(process.env.NUTSHELL_VERIFY !== "1")("PostgreSQL repository team tasks", { timeout: 30_000 }, () => {
  const revision = randomBytes(20).toString("hex");
  const entityId = `ent_task_${revision.slice(0, 12)}`;
  const receipt = randomUUID();
  const tasks: string[] = [];
  const sessions: string[] = [];
  let db: pg.Pool;
  let origin: string;
  let originalState: Record<string, unknown> | undefined;
  let originalCanConfigure: boolean | undefined;

  beforeAll(async () => {
    const config = loadConfig();
    origin = config.origin;
    await migrateAndSeed(config.databaseUrl);
    db = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 15_000 });
    originalState = (await db.query("SELECT * FROM fixture_state WHERE repository_id = $1", [repositoryId])).rows[0];
    originalCanConfigure = (await db.query<{ can_configure: boolean }>(
      "SELECT can_configure FROM local_provider_grant WHERE repository_id = $1 AND user_id = 'local-coordinator'", [repositoryId],
    )).rows[0]?.can_configure;
  }, 20_000);

  afterAll(async () => {
    await closeRuntime();
    if (!db) return;
    try {
      await db.query("DELETE FROM team_task WHERE repository_id = $1 AND id = ANY($2)", [repositoryId, tasks]);
      if (originalState) {
        await db.query(`UPDATE fixture_state SET head_revision = $3, indexed_revision = $4, indexed_epoch = $5,
          indexed_schema_version = $6, indexed_policy_version = $7 WHERE repository_id = $1 AND head_revision = $2`, [
          repositoryId, revision, originalState.head_revision, originalState.indexed_revision, originalState.indexed_epoch,
          originalState.indexed_schema_version, originalState.indexed_policy_version,
        ]);
      } else {
        await db.query("DELETE FROM fixture_state WHERE repository_id = $1 AND head_revision = $2", [repositoryId, revision]);
      }
      await db.query("DELETE FROM fixture_delivery WHERE id = $1", [receipt]);
      await db.query("DELETE FROM fixture_tree WHERE repository_id = $1 AND revision = $2", [repositoryId, revision]);
      await db.query("DELETE FROM auth_session WHERE id = ANY($1)", [sessions]);
      if (originalCanConfigure !== undefined) {
        await db.query("UPDATE local_provider_grant SET can_configure = $1 WHERE repository_id = $2 AND user_id = 'local-coordinator'", [originalCanConfigure, repositoryId]);
      }
    } finally {
      await db.end();
    }
  }, 20_000);

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

  it("enforces creator, assignee and coordinator authority and keeps date-only tasks across reconnect", async () => {
    const coordinator = await login("coordinator");
    const reader = await login("reader");
    const secondReaderSession = await login("reader");
    const outsider = await login("other");
    await db.query("UPDATE local_provider_grant SET can_configure = false WHERE repository_id = $1 AND user_id = 'local-coordinator'", [repositoryId]);
    expect(await listTeamTasks(new Headers(), repositoryKey)).toMatchObject({ status: "unavailable" });
    expect(await listTeamTasks(outsider, repositoryKey)).toMatchObject({ status: "unavailable" });
    expect(await listTeamTasks(coordinator, repositoryKey)).toMatchObject({ status: "ready", viewerId: "local-coordinator", canManage: true });
    expect(await listTeamTasks(reader, repositoryKey)).toMatchObject({ status: "ready", viewerId: "local-reader", canManage: false,
      members: expect.arrayContaining([expect.objectContaining({ id: "local-coordinator" }), expect.objectContaining({ id: "local-reader" })]) });

    const tree = await preserveFixtureTestHistory(
      db, repositoryId, buildFixtureSetupTree([], { name: "Field Notes", description: "Authorized task entity fixture.", entityId }),
    );
    await setFixtureHead(repositoryId, revision, tree);
    expect(await acceptFixtureDelivery({ deliveryId: receipt, repositoryId, installationId, revision })).toBe("accepted");
    while (await processNextFixtureDelivery()) {
      // The verification database has no continuous worker during this test.
    }
    expect(await listTeamTasks(reader, repositoryKey)).toMatchObject({ sourceRevision: revision, entities: [{ id: entityId, title: "Field Notes", kind: "module" }] });

    const title = `Task verification ${revision}`;
    expect(await createTeamTask(reader, repositoryKey, { title, assigneeId: "local-coordinator" })).toMatchObject({ status: "forbidden" });
    expect(await createTeamTask(coordinator, repositoryKey, { title, assigneeId: "local-other" })).toMatchObject({ status: "invalid" });
    expect(await createTeamTask(reader, repositoryKey, { title, entityIds: ["ent_unknown"] })).toMatchObject({ status: "invalid" });
    expect(await createTeamTask(reader, repositoryKey, { title, status: "blocked" })).toMatchObject({ status: "invalid" });

    const own = await createTeamTask(reader, repositoryKey, { title: `${title} owned`, deadline: "2028-02-29", entityIds: [entityId],
      issueNumbers: [7], pullRequestNumbers: [Number.MAX_SAFE_INTEGER] });
    if (own.status !== "created") throw new Error("Expected the reader's self-assigned task.");
    tasks.push(own.task.id);
    expect(own.task).toMatchObject({ creatorId: "local-reader", assigneeId: "local-reader", deadline: "2028-02-29", status: "todo", blocker: null,
      issueNumbers: [7], pullRequestNumbers: [Number.MAX_SAFE_INTEGER], version: 1 });
    expect((await db.query("SELECT pg_typeof(deadline)::text AS type, deadline::text FROM team_task WHERE id = $1", [own.task.id])).rows)
      .toEqual([{ type: "date", deadline: "2028-02-29" }]);
    expect(await updateTeamTask(reader, repositoryKey, own.task.id, { version: 1, changes: { assigneeId: "local-coordinator" } })).toMatchObject({ status: "forbidden" });
    expect(await updateTeamTask(outsider, "1002", own.task.id, { version: 1, changes: { description: "Cross-repo edit" } })).toMatchObject({ status: "unavailable" });

    const assigned = await createTeamTask(coordinator, repositoryKey, { title: `${title} assigned`, assigneeId: "local-reader" });
    if (assigned.status !== "created") throw new Error("Expected a coordinator-assigned task.");
    tasks.push(assigned.task.id);
    expect(assigned.task).toMatchObject({ creatorId: "local-coordinator", assigneeId: "local-reader" });
    expect(await updateTeamTask(reader, repositoryKey, assigned.task.id, { version: 1, changes: { deadline: "2028-03-01" } })).toMatchObject({ status: "forbidden" });
    expect(await deleteTeamTask(reader, repositoryKey, assigned.task.id, { version: 1 })).toMatchObject({ status: "forbidden" });
    expect(await updateTeamTask(reader, repositoryKey, assigned.task.id, { version: 1, changes: { status: "blocked" } })).toMatchObject({ status: "invalid" });
    expect(await updateTeamTask(reader, repositoryKey, assigned.task.id, { version: 1, changes: { status: "blocked", blocker: "Waiting on access" } }))
      .toMatchObject({ status: "updated", task: { status: "blocked", blocker: "Waiting on access", version: 2 } });
    expect(await updateTeamTask(reader, repositoryKey, assigned.task.id, { version: 2, changes: { status: "in_progress" } }))
      .toMatchObject({ status: "updated", task: { status: "in_progress", blocker: null, version: 3 } });

    const edits = [{ version: 1, changes: { description: "First edit" } }, { version: 1, changes: { description: "  Keep these exact attempted bytes.\r\n" } }];
    const results = await Promise.all([updateTeamTask(reader, repositoryKey, own.task.id, edits[0]),
      updateTeamTask(secondReaderSession, repositoryKey, own.task.id, edits[1])]);
    const winner = results.find((value) => value.status === "updated");
    if (!winner) throw new Error("Expected one concurrent edit to save.");
    const losingIndex = results.findIndex((value) => value.status === "conflict");
    expect(results[losingIndex]).toMatchObject({ status: "conflict", reason: "version", task: winner.task, attempted: edits[losingIndex] });
    expect(await deleteTeamTask(reader, repositoryKey, own.task.id, { version: 1 })).toMatchObject({ status: "conflict", attempted: { version: 1 } });

    await db.query("UPDATE local_provider_grant SET can_read = false WHERE repository_id = $1 AND user_id = 'local-reader'", [repositoryId]);
    try {
      expect(await listTeamTasks(reader, repositoryKey)).toMatchObject({ status: "unavailable" });
      expect(await createTeamTask(coordinator, repositoryKey, { title, assigneeId: "local-reader" })).toMatchObject({ status: "invalid" });
    } finally {
      await db.query("UPDATE local_provider_grant SET can_read = true WHERE repository_id = $1 AND user_id = 'local-reader'", [repositoryId]);
    }
    await db.query("UPDATE provider_installation SET active = false WHERE id = $1", [installationId]);
    try {
      expect(await listTeamTasks(coordinator, repositoryKey)).toMatchObject({ status: "unavailable" });
    } finally {
      await db.query("UPDATE provider_installation SET active = true WHERE id = $1", [installationId]);
    }
    expect(await listTeamTasks(reader, repositoryKey)).toMatchObject({ tasks: expect.arrayContaining([winner.task, expect.objectContaining({ id: assigned.task.id })]) });
    expect(await deleteTeamTask(coordinator, repositoryKey, own.task.id, { version: winner.task.version })).toEqual({ status: "deleted", id: own.task.id });
  });
});
