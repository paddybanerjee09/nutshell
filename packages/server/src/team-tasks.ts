import { randomUUID } from "node:crypto";
import type { RepositoryProjection } from "@nutshell/core/snapshot";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { fixturePolicyVersion, fixtureSchemaVersion, withFixtureRepositoryAccess, type FixtureRepositoryScope } from "./fixture-sync.ts";
import { fixtureSnapshot, fixtureState, membership, providerGrant, teamTask, teamTaskStatuses, user } from "./schema.ts";

export { teamTaskStatuses };
export const teamTaskLimits = { title: 160, description: 4000, blocker: 1000, references: 32 } as const;
const maximumVersion = 2_147_483_647;
const listLimit = 200;

function taskText(limit: number) {
  return z.string().max(limit).refine((value) => value.isWellFormed() && !value.includes("\0"), "Use valid text without null characters.");
}

function uniqueRefs<Value extends string | number>(entry: z.ZodType<Value>) {
  return z.array(entry).max(teamTaskLimits.references).refine((values) => new Set(values).size === values.length, "List each reference once.");
}

const repositoryNumber = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const taskVersion = z.number().int().positive().max(maximumVersion);
export const teamTaskIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "Use a valid task ID.");

export const createTeamTaskSchema = z.strictObject({
  title: taskText(teamTaskLimits.title).refine((title) => title.trim().length > 0, "Enter a task title."),
  description: taskText(teamTaskLimits.description).optional(),
  assigneeId: taskText(128).refine((id) => id.length > 0, "Choose an assignee.").optional(),
  deadline: z.iso.date().refine((value) => !value.startsWith("0000"), "Use a positive calendar year.").nullable().optional(),
  status: z.enum(teamTaskStatuses).optional(),
  blocker: taskText(teamTaskLimits.blocker).nullable().optional(),
  entityIds: uniqueRefs(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u)).optional(),
  issueNumbers: uniqueRefs(repositoryNumber).optional(),
  pullRequestNumbers: uniqueRefs(repositoryNumber).optional(),
});

export const updateTeamTaskSchema = z.strictObject({
  version: taskVersion,
  changes: createTeamTaskSchema.partial().refine((changes) => Object.values(changes).some((value) => value !== undefined), "Provide a task change."),
});
export const deleteTeamTaskSchema = z.strictObject({ version: taskVersion });

type StoredTeamTask = typeof teamTask.$inferSelect;
export type TeamTaskStatus = (typeof teamTaskStatuses)[number];
export type CreateTeamTaskInput = z.infer<typeof createTeamTaskSchema>;
export type UpdateTeamTaskInput = z.infer<typeof updateTeamTaskSchema>;
export type DeleteTeamTaskInput = z.infer<typeof deleteTeamTaskSchema>;
export type TeamTask = Omit<StoredTeamTask, "repositoryId" | "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };
export type TeamTaskMember = { id: string; name: string };
export type TeamTaskEntity = { id: string; title: string; kind: string };
export type TeamTaskList = {
  status: "ready";
  tasks: TeamTask[];
  members: TeamTaskMember[];
  viewerId: string;
  canManage: boolean;
  entities: TeamTaskEntity[];
  sourceRevision: string | null;
  truncated: boolean;
};
export type TeamTaskConflict = {
  status: "conflict";
  reason: "version";
  task: TeamTask;
  attempted: UpdateTeamTaskInput | DeleteTeamTaskInput;
};

type ErrorResult = { status: "unavailable" | "forbidden" | "invalid"; message: string };
type CreateResult = { status: "created"; task: TeamTask } | ErrorResult;
type UpdateResult = { status: "updated"; task: TeamTask } | TeamTaskConflict | ErrorResult;
type DeleteResult = { status: "deleted"; id: string } | TeamTaskConflict | ErrorResult;
type MutableTask = Pick<StoredTeamTask, "title" | "description" | "assigneeId" | "deadline" | "status" | "blocker" | "entityIds" | "issueNumbers" | "pullRequestNumbers">;

function reject(status: ErrorResult["status"], message: string): ErrorResult {
  return { status, message };
}

const unavailableRepository = () => reject("unavailable", "This repository is unavailable.");
const unavailableTask = () => reject("unavailable", "This task is unavailable.");
const invalidAssignee = () => reject("invalid", "Choose an active member with current access to this repository.");

function invalidInput(error: z.ZodError) {
  const issue = error.issues[0];
  const field = issue?.path.join(".");
  return reject("invalid", issue ? `${field ? field + ": " : ""}${issue.message}` : "Provide valid task fields.");
}

function serializeTask({ id, title, description, creatorId, assigneeId, deadline, status, blocker, entityIds, issueNumbers, pullRequestNumbers,
  version, createdAt, updatedAt }: StoredTeamTask): TeamTask {
  return { id, title, description, creatorId, assigneeId, deadline, status, blocker, entityIds, issueNumbers, pullRequestNumbers,
    version, createdAt: createdAt.toISOString(), updatedAt: updatedAt.toISOString() };
}

function conflict(task: StoredTeamTask, attempted: TeamTaskConflict["attempted"]): TeamTaskConflict {
  return { status: "conflict", reason: "version", task: serializeTask(task), attempted };
}

function scopeFilter(scope: FixtureRepositoryScope, taskId?: string) {
  return and(eq(teamTask.repositoryId, scope.repositoryId), taskId ? eq(teamTask.id, taskId) : undefined);
}

function eligibleMembers(scope: FixtureRepositoryScope, memberId?: string) {
  return scope.tx.select({ id: user.id, name: user.name }).from(membership)
    .innerJoin(providerGrant, and(eq(providerGrant.repositoryId, membership.repositoryId), eq(providerGrant.userId, membership.userId), eq(providerGrant.canRead, true)))
    .innerJoin(user, eq(user.id, membership.userId))
    .where(and(eq(membership.repositoryId, scope.repositoryId), eq(membership.active, true), memberId ? eq(membership.userId, memberId) : undefined));
}

async function canAssignTo(scope: FixtureRepositoryScope, assignee: string) {
  if (assignee === scope.userId) return true;
  const [member] = await eligibleMembers(scope, assignee).limit(1).for("share", { of: [membership, providerGrant] });
  return member !== undefined;
}

async function readPublishedEntities(scope: FixtureRepositoryScope) {
  const [snapshot] = await scope.tx.select({
    revision: fixtureSnapshot.revision,
    entities: sql<RepositoryProjection["entities"]>`${fixtureSnapshot.projection} -> 'entities'`,
  }).from(fixtureState).innerJoin(fixtureSnapshot, and(
    eq(fixtureSnapshot.repositoryId, fixtureState.repositoryId), eq(fixtureSnapshot.revision, fixtureState.indexedRevision),
    eq(fixtureSnapshot.schemaVersion, fixtureState.indexedSchemaVersion), eq(fixtureSnapshot.policyVersion, fixtureState.indexedPolicyVersion),
    eq(fixtureSnapshot.schemaVersion, fixtureSchemaVersion), eq(fixtureSnapshot.policyVersion, fixturePolicyVersion),
  )).where(and(eq(fixtureState.repositoryId, scope.repositoryId), eq(fixtureState.indexedEpoch, scope.epoch)));
  return {
    sourceRevision: snapshot?.revision ?? null,
    entities: snapshot?.entities.map(({ id, title, kind }): TeamTaskEntity => ({ id, title, kind })) ?? [],
  };
}

async function validateLinks(scope: FixtureRepositoryScope, entityIds: string[]) {
  if (entityIds.length === 0) return true;
  const { entities } = await readPublishedEntities(scope);
  const eligible = new Set(entities.map(({ id }) => id));
  return entityIds.every((id) => eligible.has(id));
}

function inputFields(input: CreateTeamTaskInput, viewerId: string): MutableTask {
  return {
    title: input.title.trim(), description: input.description ?? "", assigneeId: input.assigneeId ?? viewerId,
    deadline: input.deadline ?? null, status: input.status ?? "todo", blocker: input.blocker?.trim() || null,
    entityIds: input.entityIds ?? [], issueNumbers: input.issueNumbers ?? [], pullRequestNumbers: input.pullRequestNumbers ?? [],
  };
}

function blockerError({ status, blocker }: MutableTask) {
  if (status === "blocked" && !blocker) return reject("invalid", "Enter a reason when marking a task blocked.");
  if (status !== "blocked" && blocker) return reject("invalid", "A blocker applies to a blocked task.");
}

export async function listTeamTasks(headers: Headers, repositoryId: string): Promise<TeamTaskList | ErrorResult> {
  return await withFixtureRepositoryAccess<TeamTaskList>(headers, repositoryId, async (scope) => {
    const rows = await scope.tx.select().from(teamTask).where(scopeFilter(scope))
      .orderBy(desc(teamTask.updatedAt), asc(teamTask.id)).limit(listLimit + 1);
    const members = await eligibleMembers(scope).orderBy(asc(user.name), asc(user.id));
    const entities = await readPublishedEntities(scope);
    return { status: "ready", tasks: rows.slice(0, listLimit).map(serializeTask), members, viewerId: scope.userId,
      canManage: scope.canWrite, truncated: rows.length > listLimit, ...entities };
  }) ?? unavailableRepository();
}

export async function createTeamTask(headers: Headers, repositoryId: string, input: unknown): Promise<CreateResult> {
  const parsed = createTeamTaskSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return await withFixtureRepositoryAccess<CreateResult>(headers, repositoryId, async (scope) => {
    const fields = inputFields(parsed.data, scope.userId);
    const invalid = blockerError(fields);
    if (invalid) return invalid;
    if (fields.assigneeId !== scope.userId && !scope.canWrite) return reject("forbidden", "Only a repository coordinator may assign tasks to someone else.");
    if (!await canAssignTo(scope, fields.assigneeId)) return invalidAssignee();
    if (!await validateLinks(scope, fields.entityIds)) return reject("invalid", "Link entities from this repository's indexed source.");

    const [created] = await scope.tx.insert(teamTask).values({
      ...fields, id: randomUUID(), repositoryId: scope.repositoryId, creatorId: scope.userId,
    }).returning();
    if (!created) throw new Error("The team task could not be stored.");
    return { status: "created", task: serializeTask(created) };
  }) ?? unavailableRepository();
}

export async function updateTeamTask(headers: Headers, repositoryId: string, taskId: string, input: unknown): Promise<UpdateResult> {
  if (!teamTaskIdSchema.safeParse(taskId).success) return reject("invalid", "Use a valid task ID.");
  const parsed = updateTeamTaskSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  const { version, changes } = parsed.data;
  return await withFixtureRepositoryAccess<UpdateResult>(headers, repositoryId, async (scope) => {
    const { tx } = scope;
    const filter = scopeFilter(scope, taskId);
    const [task] = await tx.select().from(teamTask).where(filter).for("update");
    if (!task) return unavailableTask();
    const canEditDetails = scope.canWrite || task.creatorId === scope.userId;
    const isStatusChange = Object.keys(changes).every((field) => field === "status" || field === "blocker");
    if (!canEditDetails && (task.assigneeId !== scope.userId || !isStatusChange)) {
      return reject("forbidden", "Only the creator or a coordinator may edit details. The assignee may update status and blocker.");
    }
    if (changes.assigneeId && changes.assigneeId !== task.assigneeId && changes.assigneeId !== scope.userId && !scope.canWrite) {
      return reject("forbidden", "Only a repository coordinator may assign tasks to someone else.");
    }
    if (task.version !== version) return conflict(task, parsed.data);
    if (task.version === maximumVersion) return reject("invalid", "This task reached the revision limit.");

    const status = changes.status ?? task.status;
    const blocker = changes.blocker === undefined ? (status === "blocked" ? task.blocker : null) : changes.blocker;
    const fields = inputFields({
      title: changes.title ?? task.title, description: changes.description ?? task.description,
      assigneeId: changes.assigneeId ?? task.assigneeId, deadline: changes.deadline === undefined ? task.deadline : changes.deadline,
      status, blocker, entityIds: changes.entityIds ?? task.entityIds, issueNumbers: changes.issueNumbers ?? task.issueNumbers,
      pullRequestNumbers: changes.pullRequestNumbers ?? task.pullRequestNumbers,
    }, scope.userId);
    const invalid = blockerError(fields);
    if (invalid) return invalid;
    if (fields.assigneeId !== task.assigneeId && !await canAssignTo(scope, fields.assigneeId)) return invalidAssignee();
    const addedEntities = fields.entityIds.filter((id) => !task.entityIds.includes(id));
    if (!await validateLinks(scope, addedEntities)) return reject("invalid", "Link entities from this repository's indexed source.");

    const [updated] = await tx.update(teamTask).set({ ...fields, version: version + 1, updatedAt: sql`clock_timestamp()` })
      .where(and(filter, eq(teamTask.version, version))).returning();
    if (!updated) throw new Error("The locked team task changed during its update.");
    return { status: "updated", task: serializeTask(updated) };
  }) ?? unavailableRepository();
}

export async function deleteTeamTask(headers: Headers, repositoryId: string, taskId: string, input: unknown): Promise<DeleteResult> {
  if (!teamTaskIdSchema.safeParse(taskId).success) return reject("invalid", "Use a valid task ID.");
  const parsed = deleteTeamTaskSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error);
  return await withFixtureRepositoryAccess<DeleteResult>(headers, repositoryId, async (scope) => {
    const { tx } = scope;
    const filter = scopeFilter(scope, taskId);
    const [task] = await tx.select().from(teamTask).where(filter).for("update");
    if (!task) return unavailableTask();
    if (!scope.canWrite && task.creatorId !== scope.userId) return reject("forbidden", "Only the creator or a coordinator may delete a task.");
    if (task.version !== parsed.data.version) return conflict(task, parsed.data);

    const [deleted] = await tx.delete(teamTask).where(and(filter, eq(teamTask.version, parsed.data.version))).returning({ id: teamTask.id });
    if (!deleted) throw new Error("The locked team task changed during its deletion.");
    return { status: "deleted", id: deleted.id };
  }) ?? unavailableRepository();
}
