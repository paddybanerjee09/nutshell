import type { RepositoryProjection } from "@nutshell/core/snapshot";
import type { TeamNoteContent } from "@nutshell/core/team-note-content";
import { sql } from "drizzle-orm";
import { bigint, boolean, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const time = (name: string) => timestamp(name, { withTimezone: true });
const numericId = (name: string) => bigint(name, { mode: "number" });

export const user = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
});

export const session = pgTable("auth_session", {
  id: text("id").primaryKey(),
  token: text("token").notNull().unique(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  expiresAt: time("expires_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, (table) => [index("auth_session_user_id_idx").on(table.userId)]);

export const account = pgTable("auth_account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: time("access_token_expires_at"),
  refreshTokenExpiresAt: time("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, (table) => [index("auth_account_user_id_idx").on(table.userId)]);

export const verification = pgTable("auth_verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: time("expires_at").notNull(),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, (table) => [index("auth_verification_identifier_idx").on(table.identifier)]);

export const installation = pgTable("provider_installation", {
  id: numericId("id").primaryKey(),
  active: boolean("active").notNull().default(true),
});

export const repository = pgTable("repository", {
  id: numericId("id").primaryKey(),
  installationId: numericId("installation_id").notNull().references(() => installation.id),
  name: text("name").notNull(),
  description: text("description").notNull(),
  active: boolean("active").notNull().default(true),
  connectionEpoch: integer("connection_epoch").notNull().default(1),
});

export const membership = pgTable("repository_membership", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  repositoryId: numericId("repository_id").notNull().references(() => repository.id, { onDelete: "cascade" }),
  active: boolean("active").notNull().default(true),
}, (table) => [primaryKey({ columns: [table.userId, table.repositoryId] })]);

export const fixtureTree = pgTable("fixture_tree", {
  repositoryId: numericId("repository_id").notNull().references(() => repository.id, { onDelete: "cascade" }),
  revision: text("revision").notNull(),
  files: jsonb("files").$type<{ path: string; body: string }[]>().notNull(),
}, (table) => [primaryKey({ columns: [table.repositoryId, table.revision] })]);

export const fixtureSnapshot = pgTable("fixture_snapshot", {
  repositoryId: numericId("repository_id").notNull(),
  revision: text("revision").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  policyVersion: integer("policy_version").notNull(),
  projection: jsonb("projection").$type<RepositoryProjection>().notNull(),
}, (table) => [
  primaryKey({ columns: [table.repositoryId, table.revision, table.schemaVersion, table.policyVersion] }),
  foreignKey({ columns: [table.repositoryId, table.revision], foreignColumns: [fixtureTree.repositoryId, fixtureTree.revision] })
    .onDelete("cascade"),
]);

export const fixtureState = pgTable("fixture_state", {
  repositoryId: numericId("repository_id").primaryKey().references(() => repository.id, { onDelete: "cascade" }),
  headRevision: text("head_revision").notNull(),
  indexedRevision: text("indexed_revision"),
  indexedEpoch: integer("indexed_epoch"),
  indexedSchemaVersion: integer("indexed_schema_version"),
  indexedPolicyVersion: integer("indexed_policy_version"),
}, (table) => [
  foreignKey({ columns: [table.repositoryId, table.headRevision], foreignColumns: [fixtureTree.repositoryId, fixtureTree.revision] }),
  foreignKey({
    columns: [table.repositoryId, table.indexedRevision, table.indexedSchemaVersion, table.indexedPolicyVersion],
    foreignColumns: [fixtureSnapshot.repositoryId, fixtureSnapshot.revision, fixtureSnapshot.schemaVersion, fixtureSnapshot.policyVersion],
  }),
]);

export const fixtureDelivery = pgTable("fixture_delivery", {
  id: text("id").primaryKey(),
  repositoryId: numericId("repository_id").notNull().references(() => repository.id, { onDelete: "cascade" }),
  installationId: numericId("installation_id").notNull(),
  revision: text("revision").notNull(),
  connectionEpoch: integer("connection_epoch").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  policyVersion: integer("policy_version").notNull(),
  status: text("status", { enum: ["queued", "published", "obsolete", "invalid", "failed"] }).notNull().default("queued"),
  failureCode: text("failure_code"),
  attempts: integer("attempts").notNull().default(0),
  receivedAt: time("received_at").notNull().defaultNow(),
  availableAt: time("available_at").notNull().defaultNow(),
  processedAt: time("processed_at"),
}, (table) => [
  index("fixture_delivery_queue_idx").on(table.status, table.availableAt, table.receivedAt),
  index("fixture_delivery_revision_idx").on(table.repositoryId, table.revision, table.connectionEpoch),
]);

export const providerGrant = pgTable("local_provider_grant", {
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  repositoryId: numericId("repository_id").notNull().references(() => repository.id, { onDelete: "cascade" }),
  canRead: boolean("can_read").notNull().default(false),
  canWrite: boolean("can_write").notNull().default(false),
  canConfigure: boolean("can_configure").notNull().default(false),
}, (table) => [primaryKey({ columns: [table.userId, table.repositoryId] })]);

export const fixtureSetupProposal = pgTable("fixture_setup_proposal", {
  repositoryId: numericId("repository_id").notNull().references(() => repository.id, { onDelete: "cascade" }),
  connectionEpoch: integer("connection_epoch").notNull(),
  id: text("id").notNull().unique(),
  provider: text("provider", { enum: ["fixture"] }).notNull().default("fixture"),
  baseRevision: text("base_revision").notNull(),
  headRevision: text("head_revision").notNull(),
  checkedRevision: text("checked_revision").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  policyVersion: integer("policy_version").notNull(),
  mergedRevision: text("merged_revision"),
  deliveryId: text("delivery_id").notNull().unique(),
}, (table) => [
  primaryKey({ columns: [table.repositoryId, table.connectionEpoch] }),
  foreignKey({ columns: [table.repositoryId, table.baseRevision], foreignColumns: [fixtureTree.repositoryId, fixtureTree.revision] }),
  foreignKey({ columns: [table.repositoryId, table.headRevision], foreignColumns: [fixtureTree.repositoryId, fixtureTree.revision] }),
  foreignKey({ columns: [table.repositoryId, table.mergedRevision], foreignColumns: [fixtureTree.repositoryId, fixtureTree.revision] }),
]);

export const markdownDraft = pgTable("markdown_draft", {
  repositoryId: numericId("repository_id").notNull().references(() => repository.id, { onDelete: "cascade" }),
  connectionEpoch: integer("connection_epoch").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  sourceRevision: text("source_revision").notNull(),
  sourceBlob: text("source_blob").notNull(),
  markdown: text("markdown").notNull(),
  version: integer("version").notNull(),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.repositoryId, table.connectionEpoch, table.userId, table.path] }),
  foreignKey({ columns: [table.repositoryId, table.sourceRevision], foreignColumns: [fixtureTree.repositoryId, fixtureTree.revision] }),
]);

export const fixtureDraftProposal = pgTable("fixture_draft_proposal", {
  id: text("id").primaryKey(),
  repositoryId: numericId("repository_id").notNull().references(() => repository.id, { onDelete: "cascade" }),
  connectionEpoch: integer("connection_epoch").notNull(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  sourceBlob: text("source_blob").notNull(),
  draftVersion: integer("draft_version").notNull(),
  baseRevision: text("base_revision").notNull(),
  headRevision: text("head_revision").notNull(),
  previousHeadRevision: text("previous_head_revision"),
  checkedRevision: text("checked_revision").notNull(),
  schemaVersion: integer("schema_version").notNull(),
  policyVersion: integer("policy_version").notNull(),
  mergedRevision: text("merged_revision"),
  deliveryId: text("delivery_id").notNull().unique(),
  createdAt: time("created_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("fixture_draft_proposal_open_idx").on(table.repositoryId, table.connectionEpoch, table.userId, table.path)
    .where(sql`${table.mergedRevision} is null`),
  index("fixture_draft_proposal_scope_idx").on(table.repositoryId, table.connectionEpoch, table.userId, table.path, table.createdAt),
  foreignKey({ columns: [table.repositoryId, table.baseRevision], foreignColumns: [fixtureTree.repositoryId, fixtureTree.revision] }),
  foreignKey({ columns: [table.repositoryId, table.headRevision], foreignColumns: [fixtureTree.repositoryId, fixtureTree.revision] }),
  foreignKey({ columns: [table.repositoryId, table.previousHeadRevision], foreignColumns: [fixtureTree.repositoryId, fixtureTree.revision] }),
  foreignKey({ columns: [table.repositoryId, table.mergedRevision], foreignColumns: [fixtureTree.repositoryId, fixtureTree.revision] }),
]);

export const teamTaskStatuses = ["todo", "in_progress", "blocked", "done"] as const;

export const teamTask = pgTable("team_task", {
  id: uuid("id").primaryKey(),
  repositoryId: numericId("repository_id").notNull().references(() => repository.id, { onDelete: "cascade" }),
  creatorId: text("creator_id").notNull().references(() => user.id),
  assigneeId: text("assignee_id").notNull().references(() => user.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  deadline: date("deadline", { mode: "string" }),
  status: text("status", { enum: teamTaskStatuses }).notNull().default("todo"),
  blocker: text("blocker"),
  entityIds: text("entity_ids").array().notNull().default(sql`'{}'`),
  issueNumbers: numericId("issue_numbers").array().notNull().default(sql`'{}'`),
  pullRequestNumbers: numericId("pull_request_numbers").array().notNull().default(sql`'{}'`),
  version: integer("version").notNull().default(1),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, (table) => [index("team_task_scope_idx").on(table.repositoryId, table.updatedAt, table.id)]);

export const teamNote = pgTable("team_note", {
  id: uuid("id").primaryKey(),
  repositoryId: numericId("repository_id").notNull().references(() => repository.id, { onDelete: "cascade" }),
  creatorId: text("creator_id").notNull().references(() => user.id),
  title: text("title").notNull(),
  content: jsonb("content").$type<TeamNoteContent>().notNull(),
  version: integer("version").notNull().default(1),
  createdAt: time("created_at").notNull().defaultNow(),
  updatedAt: time("updated_at").notNull().defaultNow(),
}, (table) => [index("team_note_scope_idx").on(table.repositoryId, table.updatedAt, table.id)]);
