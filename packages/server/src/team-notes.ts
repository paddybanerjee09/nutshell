import { randomUUID } from "node:crypto";
import { teamNoteContentSchema } from "@nutshell/core/team-note-content";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withFixtureRepositoryAccess, type FixtureRepositoryScope } from "./fixture-sync.ts";
import { teamNote } from "./schema.ts";

export const teamNoteTitleLimit = 160;
const maximumVersion = 2_147_483_647;
const listLimit = 50;
const title = z.string().max(teamNoteTitleLimit)
  .refine((value) => value.trim().length > 0, "Enter a note title.")
  .refine((value) => value.isWellFormed() && !value.includes("\0"), "Use valid text without null characters.");
const version = z.number().int().positive().max(maximumVersion);

export const teamNoteIdSchema = z.uuidv4("Use a valid note ID.");
export const createTeamNoteSchema = z.strictObject({ title, content: teamNoteContentSchema });
export const updateTeamNoteSchema = z.strictObject({
  version,
  changes: createTeamNoteSchema.partial().refine((changes) => changes.title !== undefined || changes.content !== undefined, "Provide a note change."),
});
export const deleteTeamNoteSchema = z.strictObject({ version });

type StoredTeamNote = typeof teamNote.$inferSelect;
export type CreateTeamNoteInput = z.infer<typeof createTeamNoteSchema>;
export type UpdateTeamNoteInput = z.infer<typeof updateTeamNoteSchema>;
export type DeleteTeamNoteInput = z.infer<typeof deleteTeamNoteSchema>;
export type TeamNote = Omit<StoredTeamNote, "repositoryId" | "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };
export type TeamNoteList = { status: "ready"; notes: TeamNote[]; viewerId: string; canManage: boolean; truncated: boolean };
export type TeamNoteConflict = {
  status: "conflict";
  reason: "version";
  note: TeamNote;
  attempted: UpdateTeamNoteInput | DeleteTeamNoteInput;
};

type ErrorResult = { status: "unavailable" | "forbidden" | "invalid"; message: string };
type CreateResult = { status: "created"; note: TeamNote } | ErrorResult;
type UpdateResult = { status: "updated"; note: TeamNote } | ErrorResult | TeamNoteConflict;
type DeleteResult = { status: "deleted"; id: string } | ErrorResult | TeamNoteConflict;

function reject(status: ErrorResult["status"], message: string): ErrorResult {
  return { status, message };
}

const unavailableRepository = () => reject("unavailable", "This repository is unavailable.");
const unavailableNote = () => reject("unavailable", "This note is unavailable.");
const forbiddenNoteChange = () => reject("forbidden", "Only the creator or a repository coordinator may change this note.");

function invalidInput(error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue?.path.join(".");
  return reject("invalid", issue ? `${field ? field + ": " : ""}${issue.message}` : "Provide valid note fields.");
}

function serializeNote({ id, creatorId, title, content, version, createdAt, updatedAt }: StoredTeamNote): TeamNote {
  return { id, creatorId, title, content, version, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

function conflict(note: StoredTeamNote, attempted: TeamNoteConflict["attempted"]): TeamNoteConflict {
  return { status: "conflict", reason: "version", note: serializeNote(note), attempted };
}

function noteScope(scope: FixtureRepositoryScope, id: string) {
  return and(eq(teamNote.repositoryId, scope.repositoryId), eq(teamNote.id, id));
}

export async function listTeamNotes(headers: Headers, repositoryId: string): Promise<TeamNoteList | ErrorResult> {
  return await withFixtureRepositoryAccess<TeamNoteList>(headers, repositoryId, async (scope) => {
    const rows = await scope.tx.select().from(teamNote).where(eq(teamNote.repositoryId, scope.repositoryId))
      .orderBy(desc(teamNote.updatedAt), asc(teamNote.id)).limit(listLimit + 1);
    return { status: "ready", notes: rows.slice(0, listLimit).map(serializeNote), viewerId: scope.userId,
      canManage: scope.canWrite, truncated: rows.length > listLimit };
  }) ?? unavailableRepository();
}

export async function createTeamNote(headers: Headers, repositoryId: string, input: unknown): Promise<CreateResult> {
  const parsed = createTeamNoteSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return await withFixtureRepositoryAccess<CreateResult>(headers, repositoryId, async (scope) => {
    const [created] = await scope.tx.insert(teamNote).values({
      id: randomUUID(), repositoryId: scope.repositoryId, creatorId: scope.userId,
      title: parsed.data.title.trim(), content: parsed.data.content,
    }).returning();
    if (!created) throw new Error("The team note could not be stored.");
    return { status: "created", note: serializeNote(created) };
  }) ?? unavailableRepository();
}

export async function updateTeamNote(headers: Headers, repositoryId: string, id: string, input: unknown): Promise<UpdateResult> {
  if (!teamNoteIdSchema.safeParse(id).success) return reject("invalid", "Use a valid note ID.");
  const parsed = updateTeamNoteSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { changes, version } = parsed.data;
  return await withFixtureRepositoryAccess<UpdateResult>(headers, repositoryId, async (scope) => {
    const { tx } = scope;
    const filter = noteScope(scope, id);
    const [note] = await tx.select().from(teamNote).where(filter).for("update");
    if (!note) return unavailableNote();
    if (!scope.canWrite && note.creatorId !== scope.userId) return forbiddenNoteChange();
    if (note.version !== version) return conflict(note, parsed.data);
    if (version === maximumVersion) return reject("invalid", "This note reached the revision limit.");

    const [updated] = await tx.update(teamNote).set({
      title: changes.title?.trim() ?? note.title, content: changes.content ?? note.content,
      version: version + 1, updatedAt: sql`clock_timestamp()`,
    }).where(and(filter, eq(teamNote.version, version))).returning();
    if (!updated) throw new Error("The locked team note changed during its update.");
    return { status: "updated", note: serializeNote(updated) };
  }) ?? unavailableRepository();
}

export async function deleteTeamNote(headers: Headers, repositoryId: string, id: string, input: unknown): Promise<DeleteResult> {
  if (!teamNoteIdSchema.safeParse(id).success) return reject("invalid", "Use a valid note ID.");
  const parsed = deleteTeamNoteSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return await withFixtureRepositoryAccess<DeleteResult>(headers, repositoryId, async (scope) => {
    const { tx } = scope;
    const filter = noteScope(scope, id);
    const [note] = await tx.select().from(teamNote).where(filter).for("update");
    if (!note) return unavailableNote();
    if (!scope.canWrite && note.creatorId !== scope.userId) return forbiddenNoteChange();
    if (note.version !== parsed.data.version) return conflict(note, parsed.data);

    const [deleted] = await tx.delete(teamNote).where(and(filter, eq(teamNote.version, parsed.data.version))).returning({ id: teamNote.id });
    if (!deleted) throw new Error("The locked team note changed during its deletion.");
    return { status: "deleted", id: deleted.id };
  }) ?? unavailableRepository();
}
