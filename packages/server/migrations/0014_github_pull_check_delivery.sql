CREATE TABLE "github_pull_check_delivery" (
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'),
  "repository_id" bigint NOT NULL REFERENCES "github_repository_association" ("repository_id") ON DELETE CASCADE,
  "installation_id" bigint NOT NULL CHECK ("installation_id" > 0),
  "owner_id" bigint NOT NULL CHECK ("owner_id" > 0),
  "repository_node_id" text NOT NULL CHECK (length("repository_node_id") BETWEEN 1 AND 256),
  "connection_epoch" integer NOT NULL CHECK ("connection_epoch" > 0),
  "pull_number" bigint NOT NULL CHECK ("pull_number" > 0),
  "base_branch" text NOT NULL CHECK (length("base_branch") BETWEEN 1 AND 255),
  "base_revision" text NOT NULL CHECK ("base_revision" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  "head_revision" text NOT NULL CHECK ("head_revision" ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  "policy_version" integer NOT NULL CHECK ("policy_version" > 0),
  "status" text DEFAULT 'queued' NOT NULL CHECK ("status" IN ('queued', 'published', 'obsolete', 'failed')),
  "check_run_id" bigint CHECK ("check_run_id" > 0),
  "conclusion" text CHECK ("conclusion" IN ('success', 'failure')),
  "failure_code" text,
  "attempts" integer NOT NULL DEFAULT 0 CHECK ("attempts" >= 0),
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz,
  CHECK (("status" = 'published') = ("check_run_id" IS NOT NULL AND "conclusion" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "github_pull_check_delivery_queue_idx" ON "github_pull_check_delivery" ("status", "available_at", "received_at");
