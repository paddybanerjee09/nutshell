import { describe, expect, it } from "vitest";
import { buildFixtureSetupTree } from "./fixture-setup-tree.ts";
import { projectRepositoryTree } from "./repo-snapshot.ts";
import { bootstrapRepositoryCoverage } from "./repository-change-validation.ts";

const fixture = { name: "Field Notes", description: "Keep observations from the field.", entityId: "ent_field_notes" };
const indexPath = "nutshell-vault/_INDEX.md";
const toMap = (files: ReturnType<typeof buildFixtureSetupTree>) => new Map(files.map(({ path, body }) => [path, body]));

describe("fixture setup tree", () => {
  it("preserves owner instructions as an exact prefix and preserves all other tracked owner files", () => {
    const owner = [
      { path: "AGENTS.md", body: "\uFEFF# Owner instructions\r\n\r\nUse the supplied sample.  \r\n" },
      { path: "README.md", body: "# Handoff\r\n  Owner prose.\r\n" },
      { path: "SPEC.md", body: "# Public requirements" },
      { path: "src/collect.py", body: "# owner source\r\n" },
      { path: "docs/AGENTS.md", body: "# Instructions scoped to docs" },
    ];
    const files = buildFixtureSetupTree(owner, fixture);
    const tree = toMap(files);
    expect(tree.get("AGENTS.md")?.startsWith(owner[0]!.body + "\r\n<!-- nutshell:managed:start -->\r\n")).toBe(true);
    for (const { path, body } of owner.slice(1)) expect(tree.get(path)).toBe(body);
    expect(buildFixtureSetupTree(files, fixture)).toEqual(files);

    const result = projectRepositoryTree(tree);
    expect(result.ok).toBe(true);
    expect(result.ok && result.snapshot.entities[0]).toMatchObject({
      id: fixture.entityId, title: fixture.name, summary: fixture.description, code_paths: ["src/**"],
    });
    expect(result.ok && result.snapshot.config.coverage).toEqual(bootstrapRepositoryCoverage);
    expect(result.ok && result.snapshot.changes[0]?.entity_ids).toEqual([fixture.entityId]);
  });

  it("adds the missing managed tree with different fixture metadata and no invented code paths", () => {
    const distinct = { name: "Harbor Atlas", description: "List destinations along the coast.", entityId: "ent_harbor_atlas" };
    const tree = toMap(buildFixtureSetupTree([], distinct));
    expect(tree.has("AGENTS.md")).toBe(true);
    expect(tree.has("README.md")).toBe(true);
    expect(tree.has("SPEC.md")).toBe(true);
    expect(tree.get("nutshell-vault/CURRENT_TASK.md")).toContain("task_state: idle\ntask_revision: 0");
    expect(tree.get(indexPath)).toContain("[nutshell-vault/templates/NOTE.md]");
    expect(tree.get(indexPath)).toContain("[nutshell-vault/templates/TASK.md]");
    const result = projectRepositoryTree(tree);
    expect(result.ok && result.snapshot.entities[0]).toMatchObject({ id: distinct.entityId, title: distinct.name, code_paths: [] });
    expect(result.ok && result.snapshot.config.coverage).toEqual(bootstrapRepositoryCoverage);
  });

  it("catalogs existing active vault notes and preserves historical notes outside the index", () => {
    const setup = toMap(buildFixtureSetupTree([], fixture));
    const path = "nutshell-vault/features/Café (demo)#notes.md";
    const body = setup.get("nutshell-vault/templates/NOTE.md")!.replace("template-note", "owner-note").replace("status: active", "status: planned");
    const archived = "nutshell-vault/archive/Old.md";
    const archiveBody = body.replace("owner-note", "archived-note").replace("status: planned", "status: archived");
    const tree = toMap(buildFixtureSetupTree([{ path, body }, { path: archived, body: archiveBody }], fixture));
    expect(tree.get(path)).toBe(body);
    expect(tree.get(archived)).toBe(archiveBody);
    expect(tree.get(indexPath)).toContain("[" + path + "](<features/Caf%C3%A9%20(demo)%23notes.md>) | Repository note. | planned | template, note |");
    expect(tree.get(indexPath)).not.toContain(archived);
  });

  it.each([
    "<!-- nutshell:managed:start -->\n",
    "<!-- nutshell:managed:end -->\n<!-- nutshell:managed:start -->\n",
    "<!-- nutshell:managed:start -->\n<!-- nutshell:managed:start -->\n<!-- nutshell:managed:end -->\n",
    "<!-- Nutshell managed start -- >\n",
    "prefix <!-- nutshell:managed:start -->\n<!-- nutshell:managed:end -->\n",
  ])("refuses ambiguous or malformed owner markers %s", (body) => {
    expect(() => buildFixtureSetupTree([{ path: "AGENTS.md", body }], fixture)).toThrow("malformed or duplicate Nutshell markers");
  });

  it("refuses a conflicting managed section, catalog, or structured record", () => {
    const files = buildFixtureSetupTree([], fixture);
    const edit = (editedPath: string, body: string) => files.map((file) => file.path === editedPath ? { path: editedPath, body } : file);
    const instructions = toMap(files).get("AGENTS.md")!.replace("Keep one lead", "Always delegate the lead");
    expect(() => buildFixtureSetupTree(edit("AGENTS.md", instructions), fixture)).toThrow("different Nutshell managed section");
    expect(() => buildFixtureSetupTree(edit(indexPath, "# Incomplete owner index"), fixture)).toThrow("Setup cannot use " + indexPath);
    expect(() => buildFixtureSetupTree(edit(".nutshell/config.json", "{}"), fixture)).toThrow("conflicts with the existing .nutshell/config.json");
  });

  it("rejects unsafe trees and synthetic descriptions rather than publishing an invalid candidate", () => {
    expect(() => buildFixtureSetupTree([{ path: "../AGENTS.md", body: "owner" }], fixture)).toThrow("safe, literal");
    expect(() => buildFixtureSetupTree([{ path: ".nutshell", body: "owner file" }], fixture)).toThrow("beneath the existing file .nutshell");
    expect(() => buildFixtureSetupTree([{ path: "README.md", body: "one" }, { path: "README.md", body: "two" }], fixture)).toThrow("duplicate path");
    expect(() => buildFixtureSetupTree([], { ...fixture, entityId: "../other" })).toThrow("stable entity ID");
  });
});
