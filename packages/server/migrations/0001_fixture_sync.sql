ALTER TABLE "repository" ADD COLUMN "connection_epoch" integer NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE FUNCTION "bump_repository_connection_epoch"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.connection_epoch = OLD.connection_epoch + 1;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "repository_connection_epoch"
  BEFORE UPDATE OF "active", "installation_id" ON "repository"
  FOR EACH ROW WHEN (OLD.active IS DISTINCT FROM NEW.active OR OLD.installation_id IS DISTINCT FROM NEW.installation_id)
  EXECUTE FUNCTION "bump_repository_connection_epoch"();
--> statement-breakpoint
CREATE FUNCTION "bump_installation_repository_epochs"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "repository" SET "connection_epoch" = "connection_epoch" + 1 WHERE "installation_id" = NEW.id;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "installation_repository_epochs"
  AFTER UPDATE OF "active" ON "provider_installation"
  FOR EACH ROW WHEN (OLD.active IS DISTINCT FROM NEW.active)
  EXECUTE FUNCTION "bump_installation_repository_epochs"();
--> statement-breakpoint
CREATE TABLE "fixture_tree" (
  "repository_id" bigint NOT NULL REFERENCES "repository" ("id") ON DELETE CASCADE,
  "revision" text NOT NULL,
  "files" jsonb NOT NULL,
  PRIMARY KEY ("repository_id", "revision")
);
--> statement-breakpoint
CREATE TABLE "fixture_snapshot" (
  "repository_id" bigint NOT NULL,
  "revision" text NOT NULL,
  "schema_version" integer NOT NULL,
  "policy_version" integer NOT NULL,
  "projection" jsonb NOT NULL,
  PRIMARY KEY ("repository_id", "revision", "schema_version", "policy_version"),
  FOREIGN KEY ("repository_id", "revision") REFERENCES "fixture_tree" ("repository_id", "revision") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE "fixture_state" (
  "repository_id" bigint PRIMARY KEY REFERENCES "repository" ("id") ON DELETE CASCADE,
  "head_revision" text NOT NULL,
  "indexed_revision" text,
  "indexed_epoch" integer,
  "indexed_schema_version" integer,
  "indexed_policy_version" integer,
  FOREIGN KEY ("repository_id", "head_revision") REFERENCES "fixture_tree" ("repository_id", "revision"),
  FOREIGN KEY ("repository_id", "indexed_revision", "indexed_schema_version", "indexed_policy_version")
    REFERENCES "fixture_snapshot" ("repository_id", "revision", "schema_version", "policy_version")
);
--> statement-breakpoint
CREATE TABLE "fixture_delivery" (
  "id" text PRIMARY KEY,
  "repository_id" bigint NOT NULL REFERENCES "repository" ("id") ON DELETE CASCADE,
  "installation_id" bigint NOT NULL,
  "revision" text NOT NULL,
  "connection_epoch" integer NOT NULL,
  "schema_version" integer NOT NULL,
  "policy_version" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued', 'published', 'obsolete', 'invalid', 'failed')),
  "failure_code" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "received_at" timestamptz NOT NULL DEFAULT now(),
  "available_at" timestamptz NOT NULL DEFAULT now(),
  "processed_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX "fixture_delivery_queue_idx" ON "fixture_delivery" ("status", "available_at", "received_at");
--> statement-breakpoint
CREATE INDEX "fixture_delivery_revision_idx" ON "fixture_delivery" ("repository_id", "revision", "connection_epoch");
