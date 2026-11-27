ALTER TABLE "local_provider_grant" ADD COLUMN "can_configure" boolean NOT NULL DEFAULT false;
--> statement-breakpoint
UPDATE "local_provider_grant" AS grant_row SET "can_configure" = true
WHERE grant_row."can_read" AND grant_row."can_write" AND (
  (grant_row."user_id", grant_row."repository_id") IN (('local-coordinator', 1001), ('local-other', 1002))
) AND EXISTS (
  SELECT 1 FROM "repository_membership" AS member
  JOIN "repository" AS repo ON repo."id" = member."repository_id" AND repo."active"
  JOIN "provider_installation" AS install ON install."id" = repo."installation_id" AND install."active"
  WHERE member."repository_id" = grant_row."repository_id" AND member."user_id" = grant_row."user_id" AND member."active"
    AND (repo."id", install."id") IN ((1001, 2001), (1002, 2002))
);
--> statement-breakpoint
CREATE TABLE "fixture_setup_proposal" (
  "repository_id" bigint NOT NULL REFERENCES "repository" ("id") ON DELETE CASCADE,
  "connection_epoch" integer NOT NULL,
  "id" text NOT NULL UNIQUE,
  "provider" text NOT NULL DEFAULT 'fixture' CHECK ("provider" = 'fixture'),
  "base_revision" text NOT NULL,
  "head_revision" text NOT NULL,
  "checked_revision" text NOT NULL CHECK ("checked_revision" = "head_revision"),
  "schema_version" integer NOT NULL,
  "policy_version" integer NOT NULL,
  "merged_revision" text,
  "delivery_id" text NOT NULL UNIQUE,
  PRIMARY KEY ("repository_id", "connection_epoch"),
  FOREIGN KEY ("repository_id", "base_revision") REFERENCES "fixture_tree" ("repository_id", "revision"),
  FOREIGN KEY ("repository_id", "head_revision") REFERENCES "fixture_tree" ("repository_id", "revision"),
  FOREIGN KEY ("repository_id", "merged_revision") REFERENCES "fixture_tree" ("repository_id", "revision")
);
