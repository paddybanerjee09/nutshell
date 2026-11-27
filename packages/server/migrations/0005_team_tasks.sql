CREATE TABLE "team_task" (
  "id" uuid PRIMARY KEY,
  "repository_id" bigint NOT NULL REFERENCES "repository" ("id") ON DELETE CASCADE,
  "creator_id" text NOT NULL REFERENCES "auth_user" ("id"),
  "assignee_id" text NOT NULL REFERENCES "auth_user" ("id"),
  "title" text NOT NULL CHECK (length(btrim("title")) BETWEEN 1 AND 160),
  "description" text NOT NULL DEFAULT '' CHECK (length("description") <= 4000),
  "deadline" date,
  "status" text NOT NULL DEFAULT 'todo' CHECK ("status" IN ('todo', 'in_progress', 'blocked', 'done')),
  "blocker" text CHECK (length("blocker") <= 1000),
  "entity_ids" text[] NOT NULL DEFAULT '{}' CHECK (cardinality("entity_ids") <= 32),
  "issue_numbers" bigint[] NOT NULL DEFAULT '{}' CHECK (cardinality("issue_numbers") <= 32),
  "pull_request_numbers" bigint[] NOT NULL DEFAULT '{}' CHECK (cardinality("pull_request_numbers") <= 32),
  "version" integer NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CHECK (("status" = 'blocked' AND "blocker" IS NOT NULL AND length(btrim("blocker")) > 0) OR
    ("status" <> 'blocked' AND "blocker" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "team_task_scope_idx" ON "team_task" ("repository_id", "updated_at", "id");
