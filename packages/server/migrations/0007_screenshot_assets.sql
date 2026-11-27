CREATE TABLE "screenshot_asset" (
  "id" text PRIMARY KEY CHECK ("id" ~ '^asset_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  "repository_id" bigint NOT NULL REFERENCES "repository" ("id") ON DELETE CASCADE,
  "creator_id" text NOT NULL REFERENCES "auth_user" ("id"),
  "storage_key" uuid NOT NULL UNIQUE,
  "mime_type" text NOT NULL CHECK ("mime_type" IN ('image/png', 'image/jpeg', 'image/webp')),
  "byte_length" integer NOT NULL CHECK ("byte_length" BETWEEN 1 AND 8388608),
  "sha256" text NOT NULL CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  "width" integer NOT NULL CHECK ("width" BETWEEN 1 AND 4096),
  "height" integer NOT NULL CHECK ("height" BETWEEN 1 AND 4096),
  "provenance" text NOT NULL CHECK ("provenance" IN ('declared', 'fixture_capture')),
  "declaration" jsonb CHECK (jsonb_typeof("declaration") = 'object'),
  "capture_ref" text UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CHECK (("provenance" = 'declared' AND "capture_ref" IS NULL)
      OR ("provenance" = 'fixture_capture' AND "capture_ref" IS NOT NULL AND "declaration" IS NOT NULL))
);
