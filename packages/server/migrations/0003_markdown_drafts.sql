CREATE TABLE "markdown_draft" (
  "repository_id" bigint NOT NULL REFERENCES "repository" ("id") ON DELETE CASCADE,
  "connection_epoch" integer NOT NULL,
  "user_id" text NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  "path" text NOT NULL,
  "source_revision" text NOT NULL,
  "source_blob" text NOT NULL CHECK ("source_blob" ~ '^[0-9a-f]{64}$'),
  "markdown" text NOT NULL CHECK (octet_length("markdown") <= 262144),
  "version" integer NOT NULL CHECK ("version" > 0),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("repository_id", "connection_epoch", "user_id", "path"),
  FOREIGN KEY ("repository_id", "source_revision") REFERENCES "fixture_tree" ("repository_id", "revision")
);
