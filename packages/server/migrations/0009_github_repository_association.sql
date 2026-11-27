CREATE TABLE "github_repository_association" (
  "repository_id" bigint PRIMARY KEY REFERENCES "repository" ("id") ON DELETE CASCADE,
  "owner_id" bigint NOT NULL CHECK ("owner_id" > 0),
  "repository_node_id" text NOT NULL UNIQUE CHECK (length("repository_node_id") BETWEEN 1 AND 256)
);
