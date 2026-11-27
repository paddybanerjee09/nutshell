import { isLiteralPath, isManagedPath, readNote, readVaultCatalog, visibleLines, type VaultCatalogEntry } from "./vault.ts";

export type VaultContextSource = {
  kind: "git" | "working-tree";
  revision: string;
  read(path: string): Promise<string | undefined>;
  listPaths(includeArchive: boolean): Promise<readonly string[]>;
};

export type VaultContextRequest = { query: string; paths: readonly string[]; budget: number; includeArchive: boolean };
export type VaultContextGap = { code: string; path?: string; message: string };
export type VaultContextNote = {
  path: string;
  description: string | null;
  status: string;
  tags: string[];
  historical: boolean;
  replacement: string | null;
  score: number;
  reasons: string[];
  headings: string[];
  excerpt: string;
  truncated: boolean;
};
export type VaultContextResult = {
  source: Pick<VaultContextSource, "kind" | "revision">;
  status: "complete" | "partial" | "no_match" | "invalid";
  controls: { path: string; body: string }[];
  notes: VaultContextNote[];
  historical: VaultContextNote[];
  budget: { unit: "estimated_tokens"; limit: number; used: number; remaining: number; requiredControlTokens: number };
  gaps: VaultContextGap[];
};

export const vaultContextBudgetLimit = 32_768;
const controlPaths = ["nutshell-vault/_INDEX.md", "nutshell-vault/CURRENT_TASK.md"] as const;
const archive = "nutshell-vault/archive/";
const rootReferences = new Set(["AGENTS.md", "README.md", "SPEC.md"]);
const inactiveStatuses = new Set(["superseded", "deprecated", "archived"]);
const maxSourceBytes = 256 * 1024;
const maxExcerptBytes = 8 * 1024;
const maxRankedNotes = 12;
const maxLinkedNotes = 3;
const maxHistoricalNotes = 4;
const maxPaths = 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
const genericPathWords = new Set([
  "apps", "packages", "src", "tests", "features", "decisions", "architecture", "design", "templates", "workflows",
  "context", "notes", "nutshell", "vault", "md", "ts", "tsx", "js", "jsx", "json", "css",
]);

type Candidate = Omit<VaultCatalogEntry, "description" | "status"> & { description: string | null; status: string | null; historical: boolean };
type RankedNote = { candidate: Candidate; score: number; reasons: string[] };
type Section = { heading: string | null; lines: string[]; visible: string[]; order: number };

function bytes(text: string) {
  return encoder.encode(text).length;
}

function estimateTokens(byteLength: number) {
  return Math.ceil(byteLength / 4);
}

function words(text: string) {
  return new Set(text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
}

function matches(terms: Iterable<string>, vocabulary: ReadonlySet<string>) {
  return [...terms].filter((term) => vocabulary.has(term));
}

function lexicalPath(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rankedOrder(left: RankedNote, right: RankedNote) {
  return right.score - left.score || Number(left.candidate.historical) - Number(right.candidate.historical) ||
    lexicalPath(left.candidate.path, right.candidate.path);
}

function pathTerms(path: string) {
  return new Set([...words(path)].filter((word) => !genericPathWords.has(word)));
}

function rank(candidate: Candidate, query: ReadonlySet<string>, paths: readonly string[], matchedPaths: Set<string>): RankedNote {
  const pathVocabulary = words(candidate.path);
  const description = words(candidate.description ?? "");
  const tags = words(candidate.tags.join(" "));
  const allMetadata = new Set([...pathVocabulary, ...description, ...tags]);
  const reasons: string[] = [];
  let score = 0;

  for (const path of paths) {
    if (candidate.path === path || candidate.path.startsWith(path + "/")) {
      score += candidate.path === path ? 120 : 60;
      matchedPaths.add(path);
      reasons.push(candidate.path === path ? `exact path ${path}` : `under requested path ${path}`);
    } else {
      const related = matches(pathTerms(path), allMetadata);
      if (related.length) {
        score += related.length * 6;
        matchedPaths.add(path);
        reasons.push(`path terms ${related.slice(0, 6).join(", ")}`);
      }
    }
  }

  for (const [label, vocabulary, weight] of [["filename or path", pathVocabulary, 9], ["description", description, 5], ["tags", tags, 10]] as const) {
    const found = matches(query, vocabulary);
    if (found.length) {
      score += found.length * weight;
      reasons.push(`${label} matched ${found.slice(0, 6).join(", ")}`);
    }
  }
  return { candidate, score, reasons };
}

function splitSections(lines: string[]) {
  const visible = visibleLines(lines);
  const sections: Section[] = [];
  let start = 0;
  let heading: string | null = null;
  function add(end: number) {
    const section = lines.slice(start, end);
    if (section.some((line) => line.trim())) sections.push({ heading, lines: section, visible: visible.slice(start, end), order: sections.length });
  }

  for (const [index, line] of visible.entries()) {
    const title = /^ {0,3}#{1,2}[ \t]+(.+)$/u.exec(line)?.[1]?.replace(/(?:^|[ \t]+)#+[ \t]*$/u, "").trim();
    if (!title) continue;
    add(index);
    heading = title;
    start = index + 1;
  }
  add(lines.length);
  return sections;
}

function clipText(text: string, limit: number) {
  const encoded = encoder.encode(text);
  if (encoded.length <= limit) return text;
  let end = limit;
  while (((encoded[end] ?? 0) & 0xc0) === 0x80) end--;
  return decoder.decode(encoded.subarray(0, end)).trimEnd();
}

function excerptFrom(lines: string[], terms: ReadonlySet<string>, limit: number) {
  const ranked = splitSections(lines).map((section) => ({
    section,
    score: 4 * matches(terms, words(section.heading ?? "")).length + matches(terms, words(section.visible.join(" "))).length,
  })).sort((left, right) => right.score - left.score || left.section.order - right.section.order);
  const matching = ranked.filter(({ score }) => score > 0);
  const selected = (matching.length ? matching : ranked.slice(0, 1)).slice(0, 2).map(({ section }) => section);
  const headings: string[] = [];
  const excerpts: string[] = [];
  let remaining = limit;
  let truncated = false;
  let limited = false;
  for (const section of selected) {
    let bestLine = 0;
    let bestScore = 0;
    for (const [index, line] of section.visible.entries()) {
      const score = matches(terms, words(line)).length;
      if (score > bestScore) {
        bestLine = index;
        bestScore = score;
      }
    }
    const start = Math.max(0, bestLine - 2);
    const end = Math.min(section.lines.length, start + 28);
    const body = section.lines.slice(start, end).join("\n").trim();
    const prefix = section.heading ? `## ${section.heading}\n\n` : "";
    const separator = excerpts.length ? 2 : 0;
    const room = remaining - bytes(prefix) - separator;
    if (room <= 0) {
      truncated = true;
      limited = true;
      break;
    }
    const clipped = clipText(body, room);
    limited ||= clipped !== body;
    truncated ||= start > 0 || end < section.lines.length || clipped !== body;
    if (!clipped) continue;
    if (section.heading) headings.push(section.heading);
    const result = prefix + clipped;
    remaining -= bytes(result) + separator;
    excerpts.push(result);
  }
  return { excerpt: excerpts.join("\n\n"), headings, truncated, limited };
}

function resolvedLinkPath(origin: string, target: string) {
  const parts = target.startsWith("nutshell-vault/") ? [] : origin.split("/").slice(0, -1);
  for (const part of target.split("/")) {
    if (part === ".") continue;
    if (part === "..") {
      if (!parts.length) return;
      parts.pop();
    } else {
      if (!isLiteralPath(part) || part.toLowerCase() === ".git") return;
      parts.push(part);
    }
  }
  return parts.join("/");
}

function linkTargets(origin: VaultContextNote, candidates: ReadonlyMap<string, Candidate>, gaps: VaultContextGap[]) {
  const result = new Set<string>();
  const input = visibleLines(origin.excerpt.split("\n")).join("\n").replace(/(\x60+)[^\n]*?\1/gu, "");
  const links = /(?<![!\\])\[\[([^\]\n|]{1,512})(?:\|[^\]\n]{1,256})?\]\]|(?<![!\\])\[[^\]\n]+\]\((?:<([^<>\n]+)>|([^\s()]+))\)/gu;
  let processed = 0;
  for (const [, wiki, angle, markdown] of input.matchAll(links)) {
    if (++processed > 24) break;
    let target: string;
    try {
      target = decodeURIComponent((wiki ?? angle ?? markdown ?? "").split(/[?#]/u, 1)[0] ?? "").trim();
    } catch {
      continue;
    }
    if (!target || target.startsWith("/") || /[\\:\p{Cc}]/u.test(target)) continue;
    const filename = wiki && !/\.md$/iu.test(target) ? target + ".md" : target;
    const path = resolvedLinkPath(origin.path, filename);
    if (path && candidates.has(path)) {
      result.add(path);
    } else if (wiki && !target.includes("/")) {
      const name = filename.toLowerCase();
      const matches = [...candidates.keys()].filter((candidate) => candidate.slice(candidate.lastIndexOf("/") + 1).toLowerCase() === name);
      if (matches.length === 1) result.add(matches[0]!);
      if (matches.length > 1) gaps.push({ code: "ambiguous-link", path: origin.path, message: `Use a vault path for the ambiguous wikilink ${target}.` });
    }
  }
  return result;
}

async function readBounded(source: VaultContextSource, path: string, gaps: VaultContextGap[], control: boolean) {
  const kind = control ? "control" : "note";
  try {
    const body = await source.read(path);
    if (body === undefined) gaps.push({ path, code: kind + "-missing", message: "The selected revision does not contain this " + kind + "." });
    else if (body.length <= maxSourceBytes && bytes(body) <= maxSourceBytes) return body;
    else gaps.push({ path, code: kind + "-size", message: "The " + kind + " exceeds the retrieval file limit." });
  } catch (error) {
    gaps.push({ path, code: kind + "-read", message: error instanceof Error ? error.message : "Unable to read the selected " + kind + "." });
  }
}

function safePath(path: string) {
  return path.length <= 512 && bytes(path) <= 512 && isLiteralPath(path) &&
    !path.split("/").some((segment) => segment.toLowerCase() === ".git");
}

function validRequest(request: VaultContextRequest) {
  return Number.isSafeInteger(request.budget) && request.budget > 0 && request.budget <= vaultContextBudgetLimit &&
    request.query.length <= 2048 && request.paths.length <= 32 && request.paths.every(safePath);
}

export async function retrieveVaultContext(source: VaultContextSource, request: VaultContextRequest): Promise<VaultContextResult> {
  const { kind, revision } = source;
  const limit = Number.isSafeInteger(request.budget) ? Math.max(0, Math.min(request.budget, vaultContextBudgetLimit)) : 0;
  const result: VaultContextResult = {
    source: { kind, revision }, status: "invalid", controls: [], notes: [], historical: [],
    budget: { unit: "estimated_tokens", limit, used: 0, remaining: limit, requiredControlTokens: 0 }, gaps: [],
  };
  const { gaps, budget } = result;
  if (!validRequest(request)) {
    gaps.push({ code: "invalid-request", message: `Use a token budget from 1 to ${vaultContextBudgetLimit}, a query of at most 2,048 characters, and up to 32 safe repository paths.` });
    return result;
  }

  const index = await readBounded(source, controlPaths[0], gaps, true);
  const task = await readBounded(source, controlPaths[1], gaps, true);
  if (index === undefined || task === undefined) return result;
  let usedBytes = bytes(index) + bytes(task);
  budget.requiredControlTokens = estimateTokens(usedBytes);
  if (budget.requiredControlTokens > limit) {
    const recovery = budget.requiredControlTokens > vaultContextBudgetLimit
      ? "Shorten the controls while retaining every active catalog entry."
      : "Increase the budget to include both.";
    gaps.push({ code: "control-budget", message: `The complete index and current task need an estimated ${budget.requiredControlTokens} tokens. ${recovery}` });
    return result;
  }

  result.controls = [{ path: controlPaths[0], body: index }, { path: controlPaths[1], body: task }];
  budget.used = budget.requiredControlTokens;
  budget.remaining = limit - budget.used;
  const catalog = readVaultCatalog(index);
  gaps.push(...catalog.issues);
  const taskNote = readNote(controlPaths[1], task, (path, code, message) => { gaps.push({ path, code, message }); });
  if (taskNote && taskNote.metadata.status !== "active") gaps.push({ path: controlPaths[1], code: "control-status", message: "The current task must have status active." });
  if (gaps.length) return result;

  let paths: readonly string[];
  try {
    paths = await source.listPaths(request.includeArchive);
  } catch (error) {
    gaps.push({ code: "catalog-read", message: error instanceof Error ? error.message : "Unable to enumerate paths for the selected revision." });
    return result;
  }
  if (paths.length > maxPaths) {
    gaps.push({ code: "catalog-limit", message: `The selected vault exceeds ${maxPaths} path entries.` });
    return result;
  }

  const managed = new Set(paths.filter((path) => isManagedPath(path) && safePath(path) && (request.includeArchive || !path.startsWith(archive))));
  const rows = new Map(catalog.entries.map((row) => [row.path, row]));
  for (const { path } of catalog.entries) {
    if (!managed.has(path) || path.startsWith(archive)) gaps.push({ path, code: "index-stale", message: "This catalog path is absent, unmanaged, or archived in the selected revision." });
  }
  for (const path of [...managed].sort(lexicalPath)) {
    if (!path.startsWith(archive) && !rows.has(path)) gaps.push({ path, code: "index-missing", message: "Add the managed path to the active catalog." });
  }
  for (const path of controlPaths) {
    if (!rows.has(path) && !managed.has(path)) gaps.push({ path, code: "index-missing", message: "Add the mandatory control path to the active catalog." });
  }
  if (gaps.length) return result;

  const active = new Map<string, Candidate>();
  for (const row of catalog.entries) {
    if (!controlPaths.some((path) => path === row.path)) active.set(row.path, { ...row, historical: false });
  }
  const candidates = [...active.values()];
  if (request.includeArchive) {
    for (const path of managed) {
      if (path.startsWith(archive)) candidates.push({ path, description: null, status: null, tags: [], historical: true });
    }
  }

  const query = words(request.query);
  const matchPaths = [...new Set(request.paths)];
  const matchedPaths = new Set<string>();
  const ranked = candidates.map((candidate) => rank(candidate, query, matchPaths, matchedPaths)).filter(({ score }) => score > 0).sort(rankedOrder);
  const current = ranked.filter(({ candidate }) => !candidate.historical);
  const historical = ranked.filter(({ candidate }) => candidate.historical);
  for (const path of matchPaths) {
    if (!matchedPaths.has(path) && !controlPaths.some((control) => control === path)) gaps.push({ path, code: "path-unmatched", message: "No active catalog path or retrieval metadata matched the requested path." });
  }
  if (ranked.length === 0) {
    gaps.push({ code: "no-match", message: "No optional context matched. Try a subsystem name, tag, or a more specific repository path." });
    result.status = "no_match";
    return result;
  }
  if (current.length > maxRankedNotes) gaps.push({ code: "rank-limit", message: `Only the ${maxRankedNotes} highest-ranked current notes were selected. Narrow the query for additional context.` });
  if (historical.length > maxHistoricalNotes) gaps.push({ code: "history-limit", message: `Only the ${maxHistoricalNotes} highest-ranked historical notes were selected.` });

  const terms = new Set([...query, ...matchPaths.flatMap((path) => [...pathTerms(path)])]);
  const visited = new Set<string>();
  const byteLimit = limit * 4;
  let outOfBudget = false;
  async function include(item: RankedNote) {
    const { candidate, reasons, score } = item;
    const remaining = byteLimit - usedBytes;
    if (remaining <= 0) {
      outOfBudget = true;
      return;
    }

    const { path, description, historical } = candidate;
    visited.add(path);
    const body = await readBounded(source, path, gaps, false);
    if (body === undefined) return;
    const note = rootReferences.has(path) ? undefined : readNote(path, body, (path, code, message) => { gaps.push({ path, code, message }); });
    if (!note && !rootReferences.has(path)) return;
    const status = note?.metadata.status ?? "active";
    if (historical && !inactiveStatuses.has(status)) {
      gaps.push({ path, code: "note-lifecycle", message: "The archived path needs an inactive lifecycle status." });
      return;
    }
    if (!historical && status !== candidate.status) {
      gaps.push({ path, code: "index-status", message: "The active catalog status no longer matches the selected note." });
      return;
    }

    const lines = note?.body ?? body.split(/\r?\n/u);
    const { limited, ...content } = excerptFrom(lines, terms, Math.min(remaining, maxExcerptBytes));
    if (remaining < maxExcerptBytes && limited) outOfBudget = true;
    if (!content.excerpt) {
      if (!outOfBudget) gaps.push({ path, code: "note-empty", message: "The selected document contains no excerptable section text." });
      return;
    }
    (historical ? result.historical : result.notes).push({
      path, description, historical, status, tags: historical ? note?.metadata.tags ?? [] : candidate.tags,
      replacement: historical ? note?.metadata.superseded_by ?? null : null, reasons, score, ...content,
    });
    usedBytes += bytes(content.excerpt);
  }

  function hasRoomForMoreContext() {
    return !outOfBudget && !gaps.some(({ code }) => code === "index-status");
  }
  async function includeRanked(items: RankedNote[], maximum: number) {
    for (const item of items.slice(0, maximum)) {
      if (!hasRoomForMoreContext()) return;
      await include(item);
    }
  }
  await includeRanked(current, maxRankedNotes);

  if (hasRoomForMoreContext()) {
    const linked = new Map<string, RankedNote>();
    for (const origin of result.notes) {
      for (const path of linkTargets(origin, active, gaps)) {
        if (visited.has(path) || linked.has(path)) continue;
        const candidate = active.get(path)!;
        const related = rank(candidate, query, matchPaths, new Set());
        const sharedTag = candidate.tags.some((tag) => origin.tags.includes(tag));
        if (!related.score && !sharedTag && candidate.status !== "accepted") continue;
        linked.set(path, { ...related, score: related.score + 1, reasons: [`one-hop link from ${origin.path}`, ...related.reasons] });
      }
    }
    if (linked.size > maxLinkedNotes) gaps.push({ code: "link-limit", message: `Only ${maxLinkedNotes} relevant one-hop links were followed.` });
    await includeRanked([...linked.values()].sort(rankedOrder), maxLinkedNotes);
  }
  await includeRanked(historical, maxHistoricalNotes);

  if (outOfBudget) gaps.push({ code: "budget-limited", message: "The token budget limited optional context. Increase it or narrow the selection." });
  budget.used = estimateTokens(usedBytes);
  budget.remaining = limit - budget.used;
  result.status = gaps.some(({ code }) => code === "index-status") ? "invalid" : gaps.length ? "partial" : "complete";
  return result;
}
