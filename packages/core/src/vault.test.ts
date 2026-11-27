import { describe, expect, it } from "vitest";
import { appendVaultCatalogNote, isNewVaultNotePath, readVaultCatalog, validateVault } from "./vault.js";

const index = "nutshell-vault/_INDEX.md";
const task = "nutshell-vault/CURRENT_TASK.md";
const decision = "nutshell-vault/decisions/2026-11-26-storage.md";
const retired = "nutshell-vault/archive/2026-03-20-storage.md";
const notes = "nutshell-vault/workflows/Local setup.md";

const table = [
  "| Path | Description | Status | Tags |",
  "| --- | --- | --- | --- |",
  "| [AGENTS.md](../AGENTS.md) | Project instructions. | active | instructions |",
  "| [README.md](../README.md) | Handoff. | active | setup |",
  "| [SPEC.md](../SPEC.md) | Requirements. | active | requirements |",
  "| [nutshell-vault/_INDEX.md](_INDEX.md) | Vault catalog. | active | memory |",
  "| [nutshell-vault/CURRENT_TASK.md](CURRENT_TASK.md) | Current feature. | active | memory |",
  "| [nutshell-vault/decisions/2026-11-26-storage.md](decisions/2026-11-26-storage.md) | Storage policy. | accepted | storage |",
  "| [nutshell-vault/workflows/Local setup.md](workflows/Local%20setup.md) | Local setup. | planned | setup |",
].join("\n");

function note(id: string, status = "active", extra = "", context = "") {
  return [
    "---",
    "id: " + id,
    "date: 2026-11-26",
    "status: " + status,
    "tags: [memory]",
    ...(extra ? [extra] : []),
    "---",
    "",
    "## Context",
    context,
    "",
    "## Decision",
    "",
    "## Consequences",
    "",
    "## Affected files",
    "",
  ].join("\n");
}

function snapshot() {
  return new Map([
    [index, note("index").replace("## Decision", "## Decision\n\n" + table)],
    [task, note("task").replaceAll("\n", "\r\n")],
    [decision, note("current-storage", "accepted", "decision_key: storage.driver\nsupersedes: " + retired)],
    [retired, [
      "---",
      "id: retired-storage",
      "date: 2026-03-20",
      "status: superseded",
      "tags: [archive]",
      "decision_key: storage.driver",
      "superseded_by: " + decision,
      "---",
    ].join("\n")],
    [notes, note("local-setup", "planned", "", [
      "Documentation snippets use examples.",
      "",
      "~~~~md",
      "## Example heading",
      "~~~",
      "## Still fenced",
      "~~~~",
      "",
      "<!--",
      "## Hidden comment",
      "-->",
    ].join("\n"))],
    ["AGENTS.md", "# Instructions"],
    ["README.md", "# Handoff"],
    ["SPEC.md", "# Requirements"],
    ["node_modules/package/README.md", "# Unrelated"],
  ]);
}

function issueCodes(files: ReadonlyMap<string, string>) {
  return validateVault(files).map((issue) => issue.code);
}

describe("managed vault", () => {
  it("inserts one row into the active CRLF catalog without replacing owner bytes", () => {
    const files = snapshot();
    const original = "\uFEFF" + files.get(index)!.replace("## Context", "## Context\n\n~~~md\n" + table + "\n~~~")
      .replaceAll("\n", "\r\n");
    const newPath = "nutshell-vault/notes/Field log (draft).md";
    const markdown = note("field-log", "draft");
    const updated = appendVaultCatalogNote(original, newPath, markdown);
    expect(updated).not.toBeNull();
    const row = updated!.split("\r\n").find((line) => line.includes(newPath))!;
    expect(row).toContain("<notes/Field%20log%20(draft).md>");
    expect(updated!.replace(row + "\r\n", "")).toBe(original);
    expect(readVaultCatalog(updated!).entries.at(-1)).toMatchObject({ path: newPath, status: "draft", tags: ["memory"] });
    expect(validateVault(files.set(index, updated!).set(newPath, markdown))).toEqual([]);
    expect(appendVaultCatalogNote(updated!, newPath.toUpperCase().replace("NUTSHELL-VAULT", "nutshell-vault"), markdown)).toBeNull();
  });

  it("refuses reserved paths, bad metadata, and uncertain catalog edits", () => {
    const original = snapshot().get(index)!;
    const valid = "nutshell-vault/notes/Field log.md";
    for (const path of ["nutshell-vault/notes/INDEX.md", "nutshell-vault/Archive/log.md", "nutshell-vault/decisions/log.md",
      "nutshell-vault/templates/log.md", "nutshell-vault/../log.md", "nutshell-vault/notes/[old].md",
      "nutshell-vault/notes/ log.md", "nutshell-vault/.git/log.md"]) {
      expect(isNewVaultNotePath(path)).toBe(false);
      expect(appendVaultCatalogNote(original, path, note("log"))).toBeNull();
    }
    expect(appendVaultCatalogNote(original, valid, note("log", "archived"))).toBeNull();
    expect(appendVaultCatalogNote(original, valid, "# Missing metadata")).toBeNull();
    expect(appendVaultCatalogNote(original.replace("## Decision", "## Decision\n\n" + table), valid, note("log"))).toBeNull();
  });

  it("validates live controls and an exact catalog with historical supersession metadata", () => {
    expect(validateVault(snapshot())).toEqual([]);
  });

  it("ignores catalog examples in fenced Markdown", () => {
    const files = snapshot();
    const text = files.get(index)!;
    files.set(index, text.replace("## Context", "## Context\n\n~~~md\n" + table + "\n~~~"));
    expect(validateVault(files)).toEqual([]);
  });

  it("checks the index targets, coverage, status, and archive exclusion", () => {
    const files = snapshot();
    const text = files.get(index)!;
    files.set(index, text
      .replace("| [README.md](../README.md) | Handoff. | active | setup |", "")
      .replace("\n\n| [SPEC", "\n| [SPEC")
      .replace("(../AGENTS.md)", "(../README.md)")
      .replace("| planned | setup |", "| active | setup |")
      .replace("| [SPEC.md](../SPEC.md) | Requirements. | active | requirements |", [
        "| [SPEC.md](../SPEC.md) | Requirements. | active | requirements |",
        "| [SPEC.md](../SPEC.md) | Requirements. | active | requirements |",
        "| [" + retired + "](archive/2026-03-20-storage.md) | Old decision. | active | storage |",
        "| [nutshell-vault/removed.md](removed.md) | Removed note. | active | memory |",
      ].join("\n")));
    const issues = validateVault(files);
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "index-link", message: expect.stringContaining("AGENTS.md") }),
      expect.objectContaining({ code: "index-missing", message: expect.stringContaining("README.md") }),
      expect.objectContaining({ code: "index-status", message: expect.stringContaining(notes) }),
      expect.objectContaining({ code: "index-duplicate", message: expect.stringContaining("SPEC.md") }),
      expect.objectContaining({ code: "index-unmanaged", message: expect.stringContaining(retired) }),
      expect.objectContaining({ code: "index-unmanaged", message: expect.stringContaining("removed.md") }),
    ]));
  });

  it("requires the control files and rejects a second active router", () => {
    const files = snapshot();
    files.delete(task);
    files.set("nutshell-vault/templates/INDEX.md", note("extra-index"));
    expect(issueCodes(files)).toEqual(expect.arrayContaining(["control-missing", "index-nested"]));
  });

  it("rejects duplicate note IDs and decision keys", () => {
    const files = snapshot();
    const second = "nutshell-vault/decisions/2026-11-27-storage.md";
    files.set(second, note("current-storage", "accepted", "decision_key: storage.driver"));
    expect(issueCodes(files)).toEqual(expect.arrayContaining(["note-id-duplicate", "decision-key-duplicate"]));
  });

  it("requires active decision paths and valid dates", () => {
    const files = snapshot();
    files.set("nutshell-vault/decisions/2026-02-30-database.md", note("database", "accepted", "decision_key: database"));
    files.set(notes, files.get(notes)!.replace("2026-11-26", "2026-02-30"));
    expect(issueCodes(files)).toEqual(expect.arrayContaining(["decision-metadata", "note-metadata"]));
  });

  it("validates Markdown H2s and requires a reason for long notes", () => {
    const files = snapshot();
    files.set(notes, note("local-setup", "planned", "", "Long section.\n".repeat(200))
      .replace("## Decision", "Decision\n--------"));
    expect(issueCodes(files)).toEqual(["note-length"]);
    files.set(notes, files.get(notes)!.replace("tags: [memory]", "tags: [memory]\nlength_exception_reason: Comparison table"));
    expect(validateVault(files)).toEqual([]);
    files.set(notes, files.get(notes)!.replace("## Context", "~~~\n## Context\n~~~"));
    expect(issueCodes(files)).toEqual(["note-headings"]);
  });

  it("rejects unsafe YAML and unsafe index links", () => {
    const files = snapshot();
    files.set(task, files.get(task)!.replace("tags: [memory]", "tags: &tags [memory]\nvalue: *tags"));
    files.set(index, files.get(index)!.replace("CURRENT_TASK.md)", "%2E%2E/%2E%2E/CURRENT_TASK.md)"));
    expect(issueCodes(files)).toEqual(expect.arrayContaining(["note-frontmatter", "index-link"]));
  });

  it("rejects dangling replacements, inconsistent backlinks, and supersession cycles", () => {
    const files = snapshot();
    const other = "nutshell-vault/archive/2026-01-03-legacy.md";
    const text = files.get(retired)!;
    files.set(retired, text.replace(decision, "nutshell-vault/removed.md"));
    expect(issueCodes(files)).toEqual(expect.arrayContaining(["supersession-target", "supersession-backlink"]));
    files.set(retired, text.replace(decision, other));
    files.set(other, text.replace("id: retired-storage", "id: previous-storage").replace(decision, retired));
    expect(issueCodes(files)).toContain("supersession-cycle");
  });

  it("rejects a supersedes backlink to an archived note with a different successor", () => {
    const files = snapshot();
    files.set(retired, files.get(retired)!
      .replace("decision_key: storage.driver\n", "")
      .replace("superseded_by: " + decision, "superseded_by: " + notes));
    expect(issueCodes(files)).toContain("supersession-backlink");
  });
});
