import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceContent } from "./workspace-content";
import { workspaceData } from "./workspace-data";
import { documentResolver, markdownLinks } from "./workspace-markdown";
import { WorkspaceShell } from "./workspace-shell";

const root = "nutshell-vault/notes/";

describe("authorized snapshot workspace", () => {
  it("resolves relative and unique wiki paths while excluding code, escaped notes, external and unavailable targets", () => {
    const from = root + "Guide.md";
    const resolve = documentResolver([
      { id: "guide", path: from }, { id: "related", path: root + "Related.md" },
      { id: "first", path: "nutshell-vault/a/Duplicate.md" },
      { id: "second", path: "nutshell-vault/b/Duplicate.md" },
    ]);
    const markdown = "[[Related|Read]] and [related](./Related.md) and [reference][ok].\n\n" +
      "[[Duplicate]]\n\n\\[[Related]]\n\n`[[Guide]]`\n\n```txt\n[[Guide]]\n```\n\n" +
      "[external](https://invalid.example/Related.md) [unavailable](missing.md)\n\n[ok]: /nutshell-vault/notes/Guide.md\n";
    const resolved = markdownLinks(markdown).map((href) => resolve(from, href)).filter(Boolean);
    expect(resolved).toEqual(["related", "related", "guide"]);
    expect(resolve(from, "../../../invade.md")).toBeNull();
    expect(resolve(from, "#nutshell-note=%ZZ")).toBeNull();
  });

  it("derives backlinks and counts from published Markdown and keeps layout scoped by account and repository", () => {
    const files = [
      { path: root + "Guide.md", markdown: "---\nid: note\nstatus: active\n---\n# Guide\n\n[[Related]]\n" },
      { path: root + "Related.md", markdown: "# Related\n\nHello 🌰\n" },
    ];
    const revision = "a".repeat(40);
    const snapshot = { status: "stale", revision, headRevision: "b".repeat(40), snapshot: {
      config: { schema_version: 1, vault_root: "nutshell-vault", entity_kinds: [], coverage: { include: [], exclude: [] } },
      documents: files, entities: [], changes: [],
    } } satisfies Parameters<typeof workspaceData>[2];
    const data = workspaceData({ id: "1001", name: "Field Notes" }, "coordinator", snapshot);
    expect(data.items[0]).toMatchObject({ kind: "document", source: files[0]?.markdown,
      properties: "id: note\nstatus: active", linkedItemIds: ["document:" + root + "Related.md"] });
    expect(data.items[1]).toMatchObject({ kind: "document", words: 4, characters: 19, backlinkIds: ["document:" + root + "Guide.md"] });
    expect(data.status).toBe("stale");
    expect(data.layoutKey).not.toBe(workspaceData({ id: "1001", name: "Field Notes" }, "reader", snapshot).layoutKey);
    expect(data.layoutKey).not.toBe(workspaceData({ id: "1002", name: "Harbor Atlas" }, "coordinator", snapshot).layoutKey);
  });

  it("renders source as safe Markdown with authorized note actions and without loading remote image URLs", () => {
    const markdown = "# Guide\n\n[[Related|Open note]]\n\n![Fixture](https://private.invalid/image.png)\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)";
    const item = { kind: "document", id: "guide", title: "Guide.md", path: root + "Guide.md", properties: "tags: [fixture]",
      markdown, source: markdown,
      linkedItemIds: [], backlinkIds: [], words: 0, characters: 0 } as const;
    const document = { ...item, linkedItemIds: [], backlinkIds: [] };
    const related = { ...document, id: "related", path: root + "Related.md", title: "Related.md" };
    const html = renderToStaticMarkup(<WorkspaceContent item={document} items={[document, related]} onOpen={() => {}} />);
    expect(html).toContain("<h1>Guide</h1>");
    expect(html).toContain('class="workspace-wikilink">Open note</button>');
    expect(html).toContain("Image unavailable. Fixture");
    expect(html).not.toMatch(/<img|<script|javascript:|private\.invalid/u);
  });

  it("uses the same live reading surface and graphs while keeping fixture operations private to fixture mode", () => {
    const revision = "a".repeat(40);
    const indexedAt = "2026-11-27T16:40:00.000Z";
    const snapshot = { status: "current", revision, headRevision: revision, indexedAt, snapshot: {
      config: { schema_version: 1, vault_root: "nutshell-vault", entity_kinds: [], coverage: { include: [], exclude: [] } },
      documents: [{ path: root + "Guide.md", markdown: "# Indexed GitHub guide" }], entities: [], changes: [],
    } } satisfies Parameters<typeof workspaceData>[2];
    const repository = { id: "31", name: "Controlled repository" };
    const live = workspaceData(repository, "reader", snapshot, false, "github");
    const fixture = workspaceData(repository, "reader", snapshot, false, "fixture");
    expect(live.layoutKey).not.toBe(fixture.layoutKey);
    const markup = renderToStaticMarkup(<WorkspaceShell data={live} />);
    expect(markup).toContain("Indexed GitHub guide");
    expect(markup).toContain('aria-label="Memory Graph"');
    expect(markup).toContain('aria-label="Product Map"');
    expect(markup).toContain(indexedAt);
    expect(markup).not.toMatch(/aria-label="(?:Team tasks|Team notes|History)"|Simulate|New Markdown note/u);
  });
});
