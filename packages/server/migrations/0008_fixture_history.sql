CREATE TABLE "fixture_history_entry" (
  "repository_id" bigint NOT NULL REFERENCES "repository" ("id") ON DELETE CASCADE,
  "id" text NOT NULL CHECK ("id" ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'),
  "source_revision" text NOT NULL CHECK ("source_revision" ~ '^[0-9a-f]{40}$|^[0-9a-f]{64}$'),
  "payload" jsonb NOT NULL CHECK (jsonb_typeof("payload") = 'object' AND coalesce("payload" ->> 'id' = "id", false)),
  "payload_sha256" text NOT NULL CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  "entity_labels" jsonb NOT NULL CHECK (jsonb_typeof("entity_labels") = 'array'),
  "observed_at" timestamptz NOT NULL DEFAULT now(),
  "observation" text NOT NULL CHECK ("observation" IN ('baseline', 'indexed')),
  PRIMARY KEY ("repository_id", "id")
);
--> statement-breakpoint
CREATE INDEX "fixture_history_recent_idx" ON "fixture_history_entry" ("repository_id", "observed_at" DESC, "id");
