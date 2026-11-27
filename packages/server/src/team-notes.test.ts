import { randomUUID } from "node:crypto";
import type { TeamNoteContent } from "@nutshell/core/team-note-content";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";
import { closeRuntime, getAuth, getSession } from "./runtime.ts";
import { migrateAndSeed } from "./setup.ts";
import { createTeamNote, deleteTeamNote, listTeamNotes, updateTeamNote } from "./team-notes.ts";

const repositoryId = 1001;
const repositoryKey = String(repositoryId);
const installationId = 2001;

function paragraph(text: string): TeamNoteContent {
  return { schemaVersion: 1, doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] } };
}

describe.skipIf(process.env.NUTSHELL_VERIFY !== "1")("PostgreSQL structured team notes", { timeout: 30_000 }, () => {
  const notes: string[] = [];
  const sessions: string[] = [];
  const title = `Note verification ${randomUUID()}`;
  let db: pg.Pool;
  let origin: string;

  beforeAll(async () => {
    const config = loadConfig();
    await migrateAndSeed(config.databaseUrl);
    origin = config.origin;
    db = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 15_000 });
  }, 20_000);

  afterAll(async () => {
    await closeRuntime();
    if (!db) return;
    try {
      await db.query("DELETE FROM team_note WHERE repository_id = $1 AND id = ANY($2)", [repositoryId, notes]);
      await db.query("DELETE FROM auth_session WHERE id = ANY($1)", [sessions]);
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

  it("keeps bounded JSON, exact conflicts, creator/coordinator authority, and durable repository scope", async () => {
    const coordinator = await login("coordinator");
    const reader = await login("reader");
    const secondSession = await login("reader");
    const outsider = await login("other");
    const base = paragraph("A structured collaboration note. 検証😀");
    const { rows: sourceBefore } = await db.query("SELECT head_revision, indexed_revision FROM fixture_state WHERE repository_id = $1", [repositoryId]);
    expect(await listTeamNotes(new Headers(), repositoryKey)).toMatchObject({ status: "unavailable" });
    expect(await listTeamNotes(outsider, repositoryKey)).toMatchObject({ status: "unavailable" });
    expect(await createTeamNote(reader, repositoryKey, { title, content: base, creatorId: "local-coordinator" })).toMatchObject({ status: "invalid" });
    expect(await createTeamNote(reader, repositoryKey, { title, content: { ...base, schemaVersion: 2 } })).toMatchObject({ status: "invalid" });
    expect(await createTeamNote(reader, repositoryKey, { title, content: { schemaVersion: 1, doc: {
      type: "doc", content: [{ type: "image", attrs: { src: "https://example.com/unsupported.png" } }],
    } } })).toMatchObject({ status: "invalid" });

    const own = await createTeamNote(reader, repositoryKey, { title, content: base });
    if (own.status !== "created") throw new Error("Expected the reader's team note.");
    notes.push(own.note.id);
    expect(own.note).toMatchObject({ creatorId: "local-reader", version: 1, content: base });
    expect((await db.query("SELECT pg_typeof(content)::text AS type, content FROM team_note WHERE id = $1", [own.note.id])).rows)
      .toEqual([{ type: "jsonb", content: base }]);
    await closeRuntime();
    expect(await listTeamNotes(secondSession, repositoryKey)).toMatchObject({ status: "ready", viewerId: "local-reader", canManage: false,
      notes: expect.arrayContaining([own.note]) });
    expect(await listTeamNotes(coordinator, repositoryKey)).toMatchObject({ status: "ready", viewerId: "local-coordinator", canManage: true,
      notes: expect.arrayContaining([own.note]) });
    expect(await updateTeamNote(outsider, "1002", own.note.id, { version: 1, changes: { title: "Cross-repository attempt" } }))
      .toMatchObject({ status: "unavailable" });

    const managed = await createTeamNote(coordinator, repositoryKey, { title: `${title} coordinator`, content: base });
    if (managed.status !== "created") throw new Error("Expected the coordinator's note.");
    notes.push(managed.note.id);
    expect(await updateTeamNote(reader, repositoryKey, managed.note.id, { version: 1, changes: { title } })).toMatchObject({ status: "forbidden" });
    expect(await deleteTeamNote(reader, repositoryKey, managed.note.id, { version: 1 })).toMatchObject({ status: "forbidden" });

    const attempts = [
      { version: 1, changes: { title: "First title", content: paragraph("First rich edit.") } },
      { version: 1, changes: { title: "  Second title  ", content: paragraph("  Keep these attempted spaces and text: e\u0301 😀  ") } },
    ];
    const contenders = await Promise.all([updateTeamNote(reader, repositoryKey, own.note.id, attempts[0]),
      updateTeamNote(secondSession, repositoryKey, own.note.id, attempts[1])]);
    const winner = contenders.find((value) => value.status === "updated");
    if (!winner) throw new Error("Expected one concurrent edit to win.");
    const losingIndex = contenders.findIndex((value) => value.status === "conflict");
    expect(contenders[losingIndex]).toEqual({ status: "conflict", reason: "version", note: winner.note, attempted: attempts[losingIndex] });
    expect(await deleteTeamNote(reader, repositoryKey, own.note.id, { version: 1 })).toEqual({
      status: "conflict", reason: "version", note: winner.note, attempted: { version: 1 },
    });

    const approved = await updateTeamNote(coordinator, repositoryKey, own.note.id, { version: winner.note.version, changes: { title: `${title} reviewed` } });
    if (approved.status !== "updated") throw new Error("Expected coordinator to update a reader's note.");
    expect(approved.note).toMatchObject({ content: winner.note.content, creatorId: "local-reader", version: 3 });

    await db.query("UPDATE local_provider_grant SET can_read = false WHERE repository_id = $1 AND user_id = 'local-reader'", [repositoryId]);
    try {
      expect(await listTeamNotes(reader, repositoryKey)).toMatchObject({ status: "unavailable" });
      expect(await updateTeamNote(reader, repositoryKey, own.note.id, { version: 3, changes: { title } })).toMatchObject({ status: "unavailable" });
    } finally {
      await db.query("UPDATE local_provider_grant SET can_read = true WHERE repository_id = $1 AND user_id = 'local-reader'", [repositoryId]);
    }
    await db.query("UPDATE provider_installation SET active = false WHERE id = $1", [installationId]);
    try {
      expect(await listTeamNotes(coordinator, repositoryKey)).toMatchObject({ status: "unavailable" });
    } finally {
      await db.query("UPDATE provider_installation SET active = true WHERE id = $1", [installationId]);
    }
    expect(await listTeamNotes(reader, repositoryKey)).toMatchObject({ notes: expect.arrayContaining([approved.note]) });
    expect(await deleteTeamNote(reader, repositoryKey, own.note.id, { version: 3 })).toEqual({ status: "deleted", id: own.note.id });
    expect(await listTeamNotes(reader, repositoryKey)).toMatchObject({ notes: expect.not.arrayContaining([expect.objectContaining({ id: own.note.id })]) });
    expect((await db.query("SELECT head_revision, indexed_revision FROM fixture_state WHERE repository_id = $1", [repositoryId])).rows).toEqual(sourceBefore);
  });
});
