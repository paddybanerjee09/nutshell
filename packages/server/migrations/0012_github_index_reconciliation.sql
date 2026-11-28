ALTER TABLE "github_push_delivery"
  ADD COLUMN "source" text NOT NULL DEFAULT 'webhook' CHECK ("source" IN ('webhook', 'reconcile'));
--> statement-breakpoint
CREATE UNIQUE INDEX "github_push_delivery_reconcile_idx"
  ON "github_push_delivery" ("repository_id", "connection_epoch", "ref", "revision", "schema_version", "policy_version")
  WHERE "source" = 'reconcile' AND "status" = 'queued';
