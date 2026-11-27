CREATE TABLE "auth_user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "email_verified" boolean NOT NULL DEFAULT false,
  "image" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
  "id" text PRIMARY KEY,
  "token" text NOT NULL UNIQUE,
  "user_id" text NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "ip_address" text,
  "user_agent" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "auth_session_user_id_idx" ON "auth_session" ("user_id");
--> statement-breakpoint
CREATE TABLE "auth_account" (
  "id" text PRIMARY KEY,
  "account_id" text NOT NULL,
  "provider_id" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  "access_token" text,
  "refresh_token" text,
  "id_token" text,
  "access_token_expires_at" timestamptz,
  "refresh_token_expires_at" timestamptz,
  "scope" text,
  "password" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "auth_account_user_id_idx" ON "auth_account" ("user_id");
--> statement-breakpoint
CREATE TABLE "auth_verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" ("identifier");
--> statement-breakpoint
CREATE TABLE "provider_installation" (
  "id" bigint PRIMARY KEY,
  "active" boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "repository" (
  "id" bigint PRIMARY KEY,
  "installation_id" bigint NOT NULL REFERENCES "provider_installation" ("id"),
  "name" text NOT NULL,
  "description" text NOT NULL,
  "active" boolean NOT NULL DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "repository_membership" (
  "user_id" text NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  "repository_id" bigint NOT NULL REFERENCES "repository" ("id") ON DELETE CASCADE,
  "active" boolean NOT NULL DEFAULT true,
  PRIMARY KEY ("user_id", "repository_id")
);
--> statement-breakpoint
CREATE TABLE "local_provider_grant" (
  "user_id" text NOT NULL REFERENCES "auth_user" ("id") ON DELETE CASCADE,
  "repository_id" bigint NOT NULL REFERENCES "repository" ("id") ON DELETE CASCADE,
  "can_read" boolean NOT NULL DEFAULT false,
  "can_write" boolean NOT NULL DEFAULT false,
  PRIMARY KEY ("user_id", "repository_id")
);
