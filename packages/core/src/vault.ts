import { parseDocument } from "yaml";
import { z } from "zod";

const vault = "nutshell-vault/";
const archive = vault + "archive/";
const indexPath = vault + "_INDEX.md";
const taskPath = vault + "CURRENT_TASK.md";
const handoffPaths = new Set(["AGENTS.md", "README.md", "SPEC.md"]);
const activeStatuses = new Set(["active", "planned", "accepted", "draft"]);
const indexColumns = ["Path", "Description", "Status", "Tags"];
const noteHeadings = ["Context", "Decision", "Consequences", "Affected files"];
const nonempty = z.string().trim().min(1);

const metadataSchema = z.object({
  id: nonempty,
  date: z.iso.date(),
  status: z.enum(["active", "planned", "accepted", "draft", "superseded", "deprecated", "archived"]),
  tags: z.array(nonempty).min(1),
  decision_key: nonempty.optional(),
  length_exception_reason: nonempty.optional(),
  superseded_by: nonempty.optional(),
  supersedes: nonempty.optional(),
});

type Metadata = z.infer<typeof metadataSchema>;

export type VaultIssue = {
  path: string;
  code: string;
  message: string;
};

type Report = (path: string, code: string, message: string) => void;

function readNote(path: string, source: string, report: Report) {
  const lines = source.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end < 2) {
    report(path, "note-frontmatter", "Start the note with a delimited YAML frontmatter block.");
    return;
  }

  const yaml = lines.slice(1, end).join("\n");
  if (yaml.length > 8_192) {
    report(path, "note-frontmatter", "Keep YAML frontmatter at or below 8,192 characters.");
    return;
  }

  try {
    const document = parseDocument(yaml, { strict: true, uniqueKeys: true });
    if (document.errors.length || document.warnings.length) {
      report(path, "note-frontmatter", "Use valid YAML with unique keys and supported scalar types.");
      return;
    }
    const result = metadataSchema.safeParse(document.toJS({ maxAliasCount: 0 }));
    if (!result.success) {
      for (const issue of result.error.issues) {
        const field = issue.path.join(".") || "frontmatter";
        report(path, "note-metadata", "Invalid " + field + " field.");
      }
      return;
    }
    return {
      metadata: result.data,
      body: lines.slice(end + 1),
      lineCount: lines.length - Number(lines.at(-1) === ""),
    };
  } catch {
    report(path, "note-frontmatter", "Could not parse the YAML frontmatter. YAML aliases are unsupported.");
  }
}

function visibleLines(lines: string[]) {
  let fence: string | undefined;
  let inComment = false;
  return lines.map((line) => {
    const [, marker, suffix = ""] = /^ {0,3}(\x60{3,}|~{3,})(.*)$/u.exec(line) ?? [];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !suffix.trim()) {
        fence = undefined;
      }
      return "";
    }
    if (!inComment && marker && (marker[0] === "~" || !suffix.includes("\x60"))) {
      fence = marker;
      return "";
    }
    return line.replace(/<!--|-->|(?:(?!<!--|-->).)+/gu, (part) => {
      if (part === "<!--") {
        inComment = true;
        return "";
      }
      if (part === "-->" && inComment) {
        inComment = false;
        return "";
      }
      return inComment ? "" : part;
    });
  });
}

function secondLevelHeadings(lines: string[]) {
  const headings: string[] = [];
  let paragraph: string[] = [];
  for (const line of lines) {
    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/u.exec(line);
    if (atx?.[1] === "##") {
      headings.push((atx[2] ?? "").replace(/(?:^|[ \t]+)#+[ \t]*$/u, "").trim());
    }
    if (/^ {0,3}-+[ \t]*$/u.test(line) && paragraph.length) {
      headings.push(paragraph.join(" "));
      paragraph = [];
    } else if (!line.trim() || atx || /^(?: {4}|\t| {0,3}(?:>|[+-] |\d+[.)] |[-=]+[ \t]*$))/u.test(line)) {
      paragraph = [];
    } else {
      paragraph.push(line.trim());
    }
  }
  return headings;
}

function tableCells(line: string) {
  if (!line.includes("|") || /^(?: {4}|\t)/u.test(line)) return [];
  const cells = line.trim().split(/(?<!\\)\|/u).map((cell) => cell.trim());
  if (cells[0] === "") cells.shift();
  if (cells.at(-1) === "") cells.pop();
  return cells;
}

function isManagedPath(path: string) {
  return handoffPaths.has(path) || (path.startsWith(vault) && /\.md$/iu.test(path));
}

function isLiteralPath(path: string) {
  return !/[\\:\p{Cc}]/u.test(path) &&
    path.split("/").every((part) => part && part !== "." && part !== "..");
}

function resolveIndexDestination(target: string) {
  if (/^[/\\]|[#:?]/u.test(target)) return;
  const resolved = ["nutshell-vault"];
  for (const rawSegment of target.split("/")) {
    const segment = decodeURIComponent(rawSegment);
    if (segment === ".") continue;
    if (segment === "..") {
      if (!resolved.length) return;
      resolved.pop();
    } else {
      if (segment.includes("/") || !isLiteralPath(segment)) return;
      resolved.push(segment);
    }
  }
  return resolved.join("/");
}

function indexLink(cell: string) {
  const [, path, wrapped, plain] = /^\[([^[\]]+)\]\((?:<([^<>]+)>|([^\s()]+))\)$/u.exec(cell) ?? [];
  const target = wrapped ?? plain;
  if (!path || !target || !isLiteralPath(path)) return;
  try {
    return { path, destination: resolveIndexDestination(target) };
  } catch {
    return { path, destination: undefined };
  }
}

function validateIndex(
  lines: string[],
  activePaths: ReadonlyMap<string, string>,
  report: Report,
) {
  const rows = lines.map(tableCells);
  const tables = rows.reduce<number[]>((starts, cells, line) => {
    if (cells.join("|") === indexColumns.join("|")) starts.push(line);
    return starts;
  }, []);
  const [start] = tables;
  if (start === undefined || tables.length !== 1) {
    report(indexPath, "index-table", "Provide exactly one Path, Description, Status, Tags table.");
    return;
  }

  const divider = rows[start + 1];
  if (divider?.length !== 4 || !divider.every((cell) => /^:?-{3,}:?$/u.test(cell))) {
    report(indexPath, "index-table", "The managed table needs a four-column Markdown separator.");
    return;
  }

  const seen = new Set<string>();
  for (const [offset, cells] of rows.slice(start + 2).entries()) {
    if (!cells.length) break;
    const [label, description, rowStatus, tags] = cells;
    const link = label && indexLink(label);
    if (cells.length !== 4 || !link || !description || !rowStatus || !activeStatuses.has(rowStatus) ||
        !tags || tags.split(",").some((tag) => !tag.trim())) {
      report(indexPath, "index-row", "Invalid catalog data row " + (offset + 1) + ".");
      continue;
    }

    const { path, destination } = link;
    if (destination !== path) {
      report(indexPath, "index-link", "The link destination must resolve to its displayed path " + path + ".");
    }
    if (seen.has(path)) {
      report(indexPath, "index-duplicate", "Duplicate catalog entry for " + path + ".");
    }
    seen.add(path);

    const status = activePaths.get(path);
    if (!status) {
      report(indexPath, "index-unmanaged", "Catalog entry is missing, unmanaged, or inactive: " + path + ".");
    } else if (status !== rowStatus) {
      report(indexPath, "index-status", "Catalog status does not match the note for " + path + ".");
    }
  }
  for (const path of activePaths.keys()) {
    if (!seen.has(path)) report(indexPath, "index-missing", "Missing catalog entry for " + path + ".");
  }
}

function checkUnique(
  path: string,
  value: string,
  values: Map<string, string>,
  code: string,
  report: Report,
) {
  const existing = values.get(value);
  if (existing) {
    report(path, code, "The identifier " + value + " is already used by " + existing + ".");
  } else {
    values.set(value, path);
  }
}

function validateSupersession(notes: ReadonlyMap<string, Metadata>, report: Report) {
  for (const [path, metadata] of notes) {
    const replacement = metadata.superseded_by;
    if (metadata.status === "superseded" && !replacement) {
      report(path, "supersession-target", "A superseded note must identify its replacement.");
    }
    if (replacement) {
      const target = notes.get(replacement);
      if (!path.startsWith(archive) || metadata.status !== "superseded" ||
          replacement === path || !target ||
          (replacement.startsWith(archive) ? target.status !== "superseded" : !activeStatuses.has(target.status)) ||
          (metadata.decision_key && metadata.decision_key !== target.decision_key)) {
        report(path, "supersession-target", "The replacement must be an existing note in the same supersession lineage.");
      }
    }
    if (metadata.supersedes) {
      const previous = notes.get(metadata.supersedes);
      if (!metadata.supersedes.startsWith(archive) || previous?.status !== "superseded" ||
          previous.superseded_by !== path) {
        report(path, "supersession-backlink", "The supersedes path must identify an archived predecessor in the same lineage.");
      }
    }
  }

  const checked = new Set<string>();
  for (const start of notes.keys()) {
    const chain = new Set<string>();
    let path: string | undefined = start;
    while (path && !checked.has(path)) {
      if (chain.has(path)) {
        report(path, "supersession-cycle", "Supersession links must not form a cycle.");
        break;
      }
      chain.add(path);
      path = notes.get(path)?.superseded_by;
    }
    for (const traversed of chain) checked.add(traversed);
  }
}

export function validateVault(files: ReadonlyMap<string, string>): VaultIssue[] {
  const issues: VaultIssue[] = [];
  const report: Report = (path, code, message) => {
    issues.push({ path, code, message });
  };
  const notes = new Map<string, Metadata>();
  const activePaths = new Map<string, string>();
  const ids = new Map<string, string>();
  const decisionKeys = new Map<string, string>();
  let indexLines: string[] | undefined;

  for (const control of [indexPath, taskPath]) {
    if (!files.has(control)) report(control, "control-missing", "Required vault control file is missing.");
  }

  for (const [path, source] of files) {
    if (!isManagedPath(path)) continue;
    if (!isLiteralPath(path)) {
      report(path, "note-path", "Use a literal repository-relative Markdown path.");
      continue;
    }
    if (handoffPaths.has(path)) {
      activePaths.set(path, "active");
      continue;
    }

    const note = readNote(path, source, report);
    if (!note) continue;
    const { metadata, body, lineCount } = note;
    notes.set(path, metadata);
    checkUnique(path, metadata.id, ids, "note-id-duplicate", report);
    const inactive = !activeStatuses.has(metadata.status);
    if (path.startsWith(archive) !== inactive) {
      report(path, "note-lifecycle", "Use an inactive lifecycle status only under nutshell-vault/archive/.");
    }
    if ((path === indexPath || path === taskPath) && metadata.status !== "active") {
      report(path, "control-status", "Vault controls must have status active.");
    }
    if (path.startsWith(archive) || inactive) continue;

    activePaths.set(path, metadata.status);
    if (path !== indexPath && /\/(?:_?index|vault-index)\.md$/iu.test(path)) {
      report(path, "index-nested", "Use nutshell-vault/_INDEX.md as the only active catalog.");
    }
    const visible = visibleLines(body);
    if (path === indexPath) indexLines = visible;
    if (secondLevelHeadings(visible).join("\n") !== noteHeadings.join("\n")) {
      report(path, "note-headings", "Use the four required H2 headings in order: " + noteHeadings.join(", ") + ".");
    }
    if (path !== indexPath && lineCount >= 200 && !metadata.length_exception_reason) {
      report(path, "note-length", "Split the note or document a length_exception_reason.");
    }

    if (path.startsWith(vault + "decisions/") || metadata.decision_key) {
      if (!/^nutshell-vault\/decisions\/\d{4}-\d{2}-\d{2}-[^/]+\.md$/u.test(path) ||
          !z.iso.date().safeParse(path.slice((vault + "decisions/").length, (vault + "decisions/").length + 10)).success ||
          metadata.status !== "accepted" || !metadata.decision_key) {
        report(path, "decision-metadata", "Use a dated decision path, accepted status, and a stable decision_key.");
      }
      if (metadata.status === "accepted" && metadata.decision_key) {
        checkUnique(path, metadata.decision_key, decisionKeys, "decision-key-duplicate", report);
      }
    }
  }

  if (indexLines) validateIndex(indexLines, activePaths, report);
  validateSupersession(notes, report);
  return issues;
}
