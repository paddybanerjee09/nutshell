CREATE TABLE "github_push_delivery" (
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'),
  "repository_id" bigint NOT NULL REFERENCES "github_repository_association" ("repository_id") ON DELETE CASCADE,
  "installation_id" bigint NOT NULL CHECK ("installation_id" > 0),
  "owner_id" bigint NOT NULL CHECK ("owner_id" > 0),
  "repository_node_id" text NOT NULL CHECK (length("repository_node_id") BETWEEN 1 AND 256),
  "connection_epoch" integer NOT NULL CHECK ("connection_epoch" > 0),
  "ref" text NOT NULL CHECK ("ref" LIKE 'refs/heads/%' AND length("ref") BETWEEN 12 AND 266),
  "revision" text NOT NULL CHECK ("revision" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  "schema_version" integer NOT NULL CHECK ("schema_version" > 0),
  "policy_version" integer NOT NULL CHECK ("policy_version" > 0),
  "status" text NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued', 'published', 'obsolete', 'invalid', 'failed')),
  "failure_code" text,
  "attempts" integer NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX "github_push_delivery_queue_idx" ON "github_push_delivery" ("status", "available_at", "received_at");
--> statement-breakpoint
CREATE TABLE "github_snapshot" (
  "repository_id" bigint NOT NULL REFERENCES "github_repository_association" ("repository_id") ON DELETE CASCADE,
  "connection_epoch" integer NOT NULL CHECK ("connection_epoch" > 0),
  "revision" text NOT NULL CHECK ("revision" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  "schema_version" integer NOT NULL CHECK ("schema_version" > 0),
  "policy_version" integer NOT NULL CHECK ("policy_version" > 0),
  "projection" jsonb NOT NULL CHECK (jsonb_typeof("projection") = 'object'),
  "indexed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("repository_id", "connection_epoch", "revision", "schema_version", "policy_version")
);
--> statement-breakpoint
CREATE TABLE "github_index_state" (
  "repository_id" bigint NOT NULL REFERENCES "github_repository_association" ("repository_id") ON DELETE CASCADE,
  "connection_epoch" integer NOT NULL CHECK ("connection_epoch" > 0),
  "head_revision" text NOT NULL CHECK ("head_revision" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  "status" text NOT NULL CHECK ("status" IN ('current', 'invalid')),
  "indexed_revision" text,
  "indexed_schema_version" integer,
  "indexed_policy_version" integer,
  PRIMARY KEY ("repository_id", "connection_epoch"),
  CHECK (("indexed_revision" IS NULL AND "indexed_schema_version" IS NULL AND "indexed_policy_version" IS NULL)
    OR ("indexed_revision" IS NOT NULL AND "indexed_schema_version" IS NOT NULL AND "indexed_policy_version" IS NOT NULL)),
  CHECK ("status" <> 'current' OR coalesce("indexed_revision" = "head_revision", false)),
  FOREIGN KEY ("repository_id", "connection_epoch", "indexed_revision", "indexed_schema_version", "indexed_policy_version")
    REFERENCES "github_snapshot" ("repository_id", "connection_epoch", "revision", "schema_version", "policy_version")
);
--> statement-breakpoint
CREATE TABLE "github_accepted_change" (
  "repository_id" bigint NOT NULL REFERENCES "github_repository_association" ("repository_id") ON DELETE CASCADE,
  "connection_epoch" integer NOT NULL CHECK ("connection_epoch" > 0),
  "id" text NOT NULL CHECK ("id" ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'),
  "source_revision" text NOT NULL CHECK ("source_revision" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  "payload" jsonb NOT NULL CHECK (jsonb_typeof("payload") = 'object' AND coalesce("payload" ->> 'id' = "id", false)),
  "observed_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("repository_id", "connection_epoch", "id")
);
