CREATE TABLE "github_revocation_delivery" (
  "id" text PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'),
  "kind" text NOT NULL CHECK ("kind" IN ('installation', 'repository_selection', 'repository', 'account')),
  "scope_digest" text NOT NULL CHECK ("scope_digest" ~ '^[0-9a-f]{64}$'),
  "received_at" timestamptz NOT NULL DEFAULT now()
);
