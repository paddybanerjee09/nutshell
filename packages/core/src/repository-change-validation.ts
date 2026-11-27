import { canonicalRepositoryChange, projectRepositoryTree, repositoryChangeSchema, repositoryEntitySchema } from "./repo-snapshot.ts";
import type { RepositoryChange, RepositoryEntity, RepositoryProjection } from "./repo-snapshot.ts";

export const repositoryChangePolicyVersion = 1;

const configPath = ".nutshell/config.json";
const changesDirectory = ".nutshell/changes/";
const handoff = new Set(["AGENTS.md", "README.md", "SPEC.md"]);
const ordinaryMetadata = new Set(["readme", "license", "notice", "copying", "changelog", ".gitignore", ".gitattributes", ".editorconfig", ".mailmap"]);
const placeholders = new Set(["none", "na", "notapplicable", "todo", "tbd", "placeholder", "noimpact", "noproductimpact", "nochange", "unchanged"]);
const pathSchema = repositoryEntitySchema.shape.code_paths.element;
const maxPaths = 5_000;
const maxIssues = 200;
const maxWork = 2_000_000;
const maxManagedFile = 256 * 1024;
const maxManagedTree = 8 * 1024 * 1024;

export type RepositoryChangeValidationInput = {
  /** Complete tracked path inventories. Managed paths carry their immutable text. */
  baseFiles: ReadonlyMap<string, string>;
  headFiles: ReadonlyMap<string, string>;
  changedPaths: readonly string[];
  /** Durable records supplied by trusted application state at the selected base. */
  acceptedChanges?: ReadonlyMap<string, RepositoryChange>;
};
export type RepositoryChangeMapping = {
  path: string;
  covered: boolean;
  entityIds: readonly string[];
  changeIds: readonly string[];
  memoryPaths: readonly string[];
};
export type RepositoryChangeValidationIssue = { path: string; code: string; message: string; severity: "error" | "warning" };
export type RepositoryChangeValidationResult = {
  ok: boolean;
  policyVersion: typeof repositoryChangePolicyVersion;
  mappings: readonly RepositoryChangeMapping[];
  issues: readonly RepositoryChangeValidationIssue[];
};

type Report = (path: string, code: string, message: string, severity?: RepositoryChangeValidationIssue["severity"]) => void;

function literalPath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512 && value.isWellFormed() && !value.includes("*")
    && value.split("/").length <= 32 && pathSchema.safeParse(value).success;
}

function protectedPath(path: string) {
  return handoff.has(path) || path.startsWith(".nutshell/") || (path.startsWith("nutshell-vault/") && /\.md$/iu.test(path));
}

function bootstrapCoverage(path: string) {
  // Before configuration, treat all non-documentation and non-metadata paths as possible source.
  return !protectedPath(path) && !/\.(?:md|markdown|rst|adoc)$/iu.test(path)
    && !ordinaryMetadata.has(path.toLowerCase());
}

function meaningfulText(value: string) {
  const words = value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  return Array.from(words).length > 1 && !placeholders.has(words);
}

function matchWildcardSequence<T>(pattern: readonly T[], input: readonly T[], star: T, matches: (part: T, item: T) => boolean,
  charge: () => void): boolean {
  let p = 0;
  let i = 0;
  let previousStar = -1;
  let retry = 0;
  while (i < input.length) {
    charge();
    if (pattern[p] === star) {
      previousStar = p++;
      retry = i;
    } else if (p < pattern.length && matches(pattern[p]!, input[i]!)) {
      p++;
      i++;
    } else if (previousStar !== -1) {
      p = previousStar + 1;
      i = ++retry;
    } else return false;
  }
  while (pattern[p] === star) p++;
  return p === pattern.length;
}

function matchesGlob(pattern: readonly string[], path: readonly string[], charge: () => void) {
  return matchWildcardSequence(pattern, path, "**", (part, segment) => part.includes("*")
    ? matchWildcardSequence(Array.from(part), Array.from(segment), "*", (left, right) => left === right, charge)
    : part === segment, charge);
}

function sorted(values: Iterable<string>) {
  return [...new Set(values)].sort();
}

function changePath(id: string) {
  return changesDirectory + id + ".json";
}

function containsGlob(superset: string, subset: string) {
  if (superset === subset || superset === "**") return true;
  if (!superset.endsWith("/**")) return false;
  const prefix = superset.slice(0, -3);
  return !prefix.includes("*") && (subset === prefix || subset.startsWith(prefix + "/"));
}

function differentLiteralRoots(left: string, right: string) {
  const a = left.split("/", 1)[0]!;
  const b = right.split("/", 1)[0]!;
  return !a.includes("*") && !b.includes("*") && a !== b;
}

function checkCoveragePolicy(base: RepositoryProjection["config"]["coverage"], head: RepositoryProjection["config"]["coverage"], report: Report) {
  // Only simple containment and disjoint roots are proven here. Unproven weakenings need separate approval.
  for (const pattern of sorted(base.include)) {
    if (base.exclude.some((item) => containsGlob(item, pattern)) || head.include.some((item) => containsGlob(item, pattern))) continue;
    report(configPath, "policy-weakening", `Removing covered pattern ${pattern} requires separate approval.`);
  }
  for (const pattern of sorted(head.exclude)) {
    if (base.exclude.some((item) => containsGlob(item, pattern)) || base.include.every((item) => differentLiteralRoots(item, pattern))) continue;
    report(configPath, "policy-weakening", `Adding exclusion ${pattern} may reduce trusted coverage and requires separate approval.`);
  }
}

function preserveBootstrapRecords(base: ReadonlyMap<string, string>, changes: readonly RepositoryChange[], report: Report) {
  const candidate = new Map(changes.map((change) => [changePath(change.id), change]));
  for (const [path, raw] of base) {
    if (!path.startsWith(changesDirectory)) continue;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { /* Invalid base record is reported below. */ }
    const prior = repositoryChangeSchema.safeParse(value);
    const next = candidate.get(path);
    if (!prior.success || changePath(prior.data.id) !== path) {
      report(path, "record-schema", "The base change record is invalid.");
    } else if (!next) {
      report(path, "change-removed", "Keep the prior change record when setting up the repository.");
    } else if (canonicalRepositoryChange(prior.data) !== canonicalRepositoryChange(next)) {
      report(path, "change-rewritten", "Keep the prior change payload when setting up the repository.");
    }
  }
}

class MappingLimit extends Error {}

function mapChanges(paths: readonly string[], base: RepositoryProjection | undefined, head: RepositoryProjection,
  fresh: readonly RepositoryChange[], report: Report): RepositoryChangeMapping[] {
  const entities = new Map<string, { codePatterns: Set<string>; memory: Set<string> }>();
  function collect(entity: RepositoryEntity) {
    let indexed = entities.get(entity.id);
    const ownsCode = entity.lifecycle === "active" || entity.lifecycle === "deprecated";
    if (!indexed) {
      if (!ownsCode) return;
      indexed = { codePatterns: new Set(), memory: new Set() };
      entities.set(entity.id, indexed);
    }
    if (ownsCode) for (const path of entity.code_paths) indexed.codePatterns.add(path);
    for (const path of entity.memory_paths) indexed.memory.add(path);
  }
  for (const entity of base?.entities ?? []) collect(entity);
  for (const entity of head.entities) collect(entity);
  const indexed = [...entities].map(([id, { codePatterns, memory }]) => ({ id, patterns: [...codePatterns].map((pattern) => pattern.split("/")), memory }));
  const include = base?.config.coverage.include.map((pattern) => pattern.split("/")) ?? [];
  const exclude = base?.config.coverage.exclude.map((pattern) => pattern.split("/")) ?? [];
  const globalClassifications = fresh.filter((change) => change.product_impact !== "user_visible" && change.entity_ids.length === 0);
  const byEntity = new Map<string, RepositoryChange[]>();
  for (const change of fresh) for (const entityId of change.entity_ids) {
    const prior = byEntity.get(entityId);
    if (prior) prior.push(change);
    else byEntity.set(entityId, [change]);
  }

  let work = 0;
  function charge() {
    if (++work > maxWork) throw new MappingLimit();
  }

  return paths.map((path) => {
    const segments = path.split("/");
    const matches = (pattern: readonly string[]) => matchesGlob(pattern, segments, charge);
    const covered = base ? include.some(matches) && !exclude.some(matches) : bootstrapCoverage(path);
    const matchesEntities = indexed.filter(({ patterns }) => { charge(); return patterns.some(matches); });
    const entityIds = sorted(matchesEntities.map(({ id }) => id));
    const declarations = new Set<RepositoryChange>();
    const memory = new Set<string>();
    for (const match of matchesEntities) {
      for (const note of match.memory) { charge(); memory.add(note); }
      for (const change of byEntity.get(match.id) ?? []) { charge(); declarations.add(change); }
    }

    if (covered && entityIds.length === 0) {
      for (const change of globalClassifications) { charge(); declarations.add(change); }
      report(path, "covered-unmapped", declarations.size
        ? "Covered source has no entity mapping. A new internal or no-impact declaration explains the change."
        : "Covered source has no entity mapping or new internal or no-impact declaration.", declarations.size ? "warning" : "error");
    } else if (covered && declarations.size === 0) {
      report(path, "covered-undeclared", "Add a new meaningful change record naming an affected entity.");
    }

    for (const change of declarations) for (const note of change.memory_paths) { charge(); memory.add(note); }
    return { path, covered, entityIds, changeIds: sorted([...declarations].map(({ id }) => id)), memoryPaths: sorted(memory) };
  });
}

export function validateRepositoryChanges({ baseFiles, headFiles, changedPaths, acceptedChanges }: RepositoryChangeValidationInput): RepositoryChangeValidationResult {
  const issues: RepositoryChangeValidationIssue[] = [];
  let failed = false;
  function report(path: string, code: string, message: string, severity: RepositoryChangeValidationIssue["severity"] = "error") {
    if (severity === "error") failed = true;
    if (issues.length < maxIssues - 1) issues.push({ path, code, message, severity });
    else if (issues.length < maxIssues) issues.push({ path: ".", code: "issue-limit", message: "Additional validation issues were omitted.", severity });
    else if (severity === "error") issues[maxIssues - 1]!.severity = "error";
  }
  function result(mappings: readonly RepositoryChangeMapping[] = []): RepositoryChangeValidationResult {
    return { ok: !failed, policyVersion: repositoryChangePolicyVersion, mappings, issues };
  }

  if (!Array.isArray(changedPaths)) {
    report(".", "changed-path-invalid", "Provide the immutable diff as a list of literal paths.");
    return result();
  }
  if (baseFiles.size > maxPaths || headFiles.size > maxPaths || changedPaths.length > maxPaths * 2 || (acceptedChanges?.size ?? 0) > maxPaths) {
    report(".", "tree-size", "The immutable comparison exceeds its path budget.");
    return result();
  }

  const changed = new Set<string>();
  for (const path of changedPaths) {
    if (!literalPath(path)) report(".", "changed-path-invalid", "Compare only safe, literal repository paths.");
    else changed.add(path);
  }
  let baseLength = 0;
  let headLength = 0;
  for (const path of sorted([...baseFiles.keys(), ...headFiles.keys()])) {
    const before = baseFiles.get(path);
    const after = headFiles.get(path);
    if (!literalPath(path)) {
      report(".", "tree-path", "The immutable tree contains an unsafe repository path.");
    } else if ((baseFiles.has(path) && typeof before !== "string") || (headFiles.has(path) && typeof after !== "string")) {
      report(path, "tree-content", "Provide text or a path-only entry from each immutable tree.");
    } else if (protectedPath(path)) {
      baseLength += before?.length ?? 0;
      headLength += after?.length ?? 0;
      if (baseLength > maxManagedTree || headLength > maxManagedTree) {
        report(".", "tree-content-size", "The immutable comparison exceeds its managed content budget.");
        return result();
      }
      if ([before, after].some((value) => value !== undefined && value.length > maxManagedFile)) {
        report(path, "file-size", "A managed file exceeds the immutable comparison's file size limit.");
      } else if ([before, after].some((value) => value !== undefined && (!value.isWellFormed() || value.includes("\0")))) {
        report(path, "tree-content", "Managed files must use valid Unicode text without null characters.");
      } else if (before !== after && !changed.has(path)) {
        report(path, "protected-change-missing", "The immutable diff omitted this changed managed file.");
      }
    } else if (baseFiles.has(path) !== headFiles.has(path) && !changed.has(path)) {
      report(path, "changed-path-missing", "The immutable diff omitted this added or removed path.");
    }
  }
  for (const path of sorted(changed)) if (!baseFiles.has(path) && !headFiles.has(path)) {
    if (protectedPath(path)) report(path, "protected-input-missing", "Read the changed managed file from its immutable revision.");
    else report(path, "diff-path-unknown", "The changed path is absent from both immutable trees.");
  }
  if (failed) return result();

  let base: RepositoryProjection | undefined;
  if (baseFiles.has(configPath)) {
    const projection = projectRepositoryTree(baseFiles, { acceptedChanges });
    if (!projection.ok) {
      for (const issue of projection.issues) report(issue.path, issue.code, "Invalid base snapshot. " + issue.message);
      return result();
    }
    base = projection.snapshot;
  } else if (acceptedChanges?.size) {
    report(configPath, "config-missing", "The accepted history requires its trusted base configuration.");
    return result();
  }

  const prior = new Map((base?.changes ?? []).map((change) => [change.id, change]));
  const projection = projectRepositoryTree(headFiles, { acceptedChanges: prior });
  if (!projection.ok) {
    for (const issue of projection.issues) report(issue.path, issue.code, issue.message);
    return result();
  }
  const head = projection.snapshot;
  if (base) checkCoveragePolicy(base.config.coverage, head.config.coverage, report);
  else preserveBootstrapRecords(baseFiles, head.changes, report);
  const fresh: RepositoryChange[] = [];
  for (const record of head.changes) {
    if (prior.has(record.id) || baseFiles.has(changePath(record.id))) continue;
    if ([record.summary, record.rationale, record.technical_summary].every(meaningfulText)) fresh.push(record);
    else report(changePath(record.id), "change-placeholder", "Use a specific summary, rationale and technical explanation.");
  }

  try {
    return result(mapChanges(sorted(changed), base, head, fresh, report));
  } catch (error) {
    if (!(error instanceof MappingLimit)) throw error;
    report(".", "mapping-limit", "The immutable comparison exceeds its source mapping work budget.");
    return result();
  }
}
