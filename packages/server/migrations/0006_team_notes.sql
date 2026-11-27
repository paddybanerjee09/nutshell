CREATE TABLE "team_note" (
  "id" uuid PRIMARY KEY,
  "repository_id" bigint NOT NULL REFERENCES "repository" ("id") ON DELETE CASCADE,
  "creator_id" text NOT NULL REFERENCES "auth_user" ("id"),
  "title" text NOT NULL CHECK (length(btrim("title")) BETWEEN 1 AND 160),
  "content" jsonb NOT NULL CHECK (jsonb_typeof("content") = 'object' AND coalesce("content" -> 'schemaVersion' = '1'::jsonb, false)),
  "version" integer NOT NULL DEFAULT 1 CHECK ("version" > 0),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "team_note_scope_idx" ON "team_note" ("repository_id", "updated_at", "id");
