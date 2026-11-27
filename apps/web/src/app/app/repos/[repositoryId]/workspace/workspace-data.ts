import { createHash } from "node:crypto";
import { parseFrontmatter } from "@nutshell/core/frontmatter";
import type { FixtureSnapshotRead } from "@nutshell/server/fixture-sync";
import { documentResolver, markdownLinks } from "./workspace-markdown";

type Projection = NonNullable<FixtureSnapshotRead["snapshot"]>;
type IndexedSnapshot = FixtureSnapshotRead & { status: WorkspaceData["status"]; snapshot: Projection; revision: string };

type Item = { id: string; title: string; path: string };
type DocumentItem = Item & {
  kind: "document";
  markdown: string;
  properties: string;
  linkedItemIds: string[];
  backlinkIds: string[];
  words: number;
  characters: number;
};
type EntityItem = Item & { kind: "entity"; entity: Projection["entities"][number] };

export type WorkspaceItem = DocumentItem | EntityItem;
export type WorkspaceData = {
  repositoryName: string;
  repositoryHref: string;
  layoutKey: string;
  revision: string;
  headRevision: string | null;
  status: "current" | "stale" | "invalid";
  initialItemId: string | null;
  items: WorkspaceItem[];
  changes: Projection["changes"];
};

export function hasIndexedSnapshot(snapshot: FixtureSnapshotRead): snapshot is IndexedSnapshot {
  return snapshot.status !== "pending" && snapshot.revision !== null && snapshot.snapshot !== null;
}

export function workspaceData(repository: { id: string; name: string }, userId: string, indexed: IndexedSnapshot): WorkspaceData {
  const documents = indexed.snapshot.documents.map(({ path, markdown }): DocumentItem => {
    const parsed = parseFrontmatter(markdown);
    const body = parsed.ok ? parsed.lines.slice(parsed.bodyStart).join("\n") : markdown;
    const properties = parsed.ok ? parsed.lines.slice(1, parsed.bodyStart - 1).join("\n") : "";
    const title = path.slice(path.lastIndexOf("/") + 1);
    return { kind: "document", id: "document:" + path, title, path, markdown: body, properties,
      linkedItemIds: [], backlinkIds: [], words: (body.match(/\S+/gu) ?? []).length, characters: Array.from(body).length };
  });
  const resolve = documentResolver(documents);
  const byId = new Map(documents.map((item) => [item.id, item]));
  for (const item of documents) {
    const outgoing = new Set<string>();
    for (const href of markdownLinks(item.markdown)) {
      const id = resolve(item.path, href);
      if (id && id !== item.id) outgoing.add(id);
    }
    item.linkedItemIds = [...outgoing];
    for (const id of outgoing) byId.get(id)?.backlinkIds.push(item.id);
  }
  const entities = indexed.snapshot.entities.map((entity): EntityItem => ({
    kind: "entity", id: "entity:" + entity.id, title: entity.title, path: ".nutshell/entities/" + entity.id + ".json", entity,
  }));
  const items = [...documents, ...entities];
  const initial = documents.find(({ path }) => path.startsWith("nutshell-vault/features/")) ?? items[0];
  const scope = createHash("sha256").update(JSON.stringify([userId, repository.id])).digest("hex");
  return {
    repositoryName: repository.name,
    repositoryHref: "/app/repos/" + repository.id,
    layoutKey: "nutshell.workspace." + scope,
    revision: indexed.revision,
    headRevision: indexed.headRevision,
    status: indexed.status,
    initialItemId: initial?.id ?? null,
    items,
    changes: indexed.snapshot.changes,
  };
}
