CREATE TABLE "fixture_draft_proposal" (
  "id" text PRIMARY KEY,
  "repository_id" bigint NOT NULL REFERENCES "repository" ("id") ON DELETE CASCADE,
  "connection_epoch" integer NOT NULL,
  "user_id" text NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  "path" text NOT NULL,
  "source_blob" text NOT NULL CHECK ("source_blob" ~ '^[0-9a-f]{64}$'),
  "draft_version" integer NOT NULL CHECK ("draft_version" > 0),
  "base_revision" text NOT NULL,
  "head_revision" text NOT NULL,
  "previous_head_revision" text,
  "checked_revision" text NOT NULL CHECK ("checked_revision" = "head_revision"),
  "schema_version" integer NOT NULL,
  "policy_version" integer NOT NULL,
  "merged_revision" text,
  "delivery_id" text NOT NULL UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("repository_id", "base_revision") REFERENCES "fixture_tree" ("repository_id", "revision"),
  FOREIGN KEY ("repository_id", "head_revision") REFERENCES "fixture_tree" ("repository_id", "revision"),
  FOREIGN KEY ("repository_id", "previous_head_revision") REFERENCES "fixture_tree" ("repository_id", "revision"),
  FOREIGN KEY ("repository_id", "merged_revision") REFERENCES "fixture_tree" ("repository_id", "revision")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "fixture_draft_proposal_open_idx" ON "fixture_draft_proposal" ("repository_id", "connection_epoch", "user_id", "path")
WHERE "merged_revision" IS NULL;
--> statement-breakpoint
CREATE INDEX "fixture_draft_proposal_scope_idx" ON "fixture_draft_proposal" ("repository_id", "connection_epoch", "user_id", "path", "created_at");
