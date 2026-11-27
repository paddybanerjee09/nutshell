import { z } from "zod";
import { validateVault, type VaultIssue } from "./vault.ts";

const configPath = ".nutshell/config.json";
const vaultRoot = "nutshell-vault";
const references = ["AGENTS.md", "README.md", "SPEC.md"];
const defaultKinds = ["feature", "screen", "service", "module"];
const recordPath = /^\.nutshell\/(entities|changes)\/([^/]+)\.json$/u;

function safeRelativePath(value: string) {
  return !/[\\:<>"|?[\]{}\p{Cc}]|%(?:00|2e|2f|5c)/iu.test(value) &&
    value.split("/").every((segment) =>
      segment && !/[. ]$/u.test(segment) && !/^(?:\.git|git~1)$/iu.test(segment));
}

const literalPath = z.string().min(1).max(512).refine((value) => safeRelativePath(value) && !value.includes("*"));
// A single * stays within a path segment. Only a whole ** segment can cross directories.
const pathPattern = z.string().min(1).max(512).refine((value) => safeRelativePath(value) &&
  value.split("/").every((segment) => !segment.includes("**") || segment === "**"));
const memoryPath = literalPath.refine((value) => value.startsWith(vaultRoot + "/") && /\.md$/iu.test(value));

const recordId = z.string().max(80).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u);
const kindSlug = z.string().max(40).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
const text = (limit: number) => z.string().min(1).max(limit).refine((value) => Boolean(value.trim()));
const route = z.string().max(512).refine((value) => value.startsWith("/") && !value.includes("//") &&
  !/[\\?#\p{Cc}]|%(?:00|2e|2f|5c)/iu.test(value) &&
  value.split("/").every((segment) => segment !== "." && segment !== ".."));

export const repositoryConfigSchema = z.strictObject({
  schema_version: z.literal(1),
  vault_root: z.literal(vaultRoot),
  entity_kinds: z.array(z.strictObject({ slug: kindSlug, label: text(80) })).min(4).max(32),
  coverage: z.strictObject({ include: z.array(pathPattern).max(64), exclude: z.array(pathPattern).max(64) }),
});

export const repositoryEntitySchema = z.strictObject({
  schema_version: z.literal(1),
  id: recordId,
  kind: kindSlug,
  title: text(160),
  summary: text(600),
  lifecycle: z.enum(["planned", "active", "deprecated", "removed"]),
  code_paths: z.array(pathPattern).max(64),
  memory_paths: z.array(memoryPath).max(64),
  relations: z.array(z.strictObject({
    type: z.enum(["part_of", "depends_on", "implemented_by", "appears_on"]),
    target: recordId,
  })).max(64),
  display_group: text(80).optional(),
  screen: z.strictObject({ route_patterns: z.array(route).max(32) }).optional(),
});

const screenshot = z.strictObject({
  kind: z.literal("screenshot"),
  asset_id: recordId,
  source_revision: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu),
  route,
  state: text(80),
  viewport: z.strictObject({ width: z.number().int().min(1).max(16_384), height: z.number().int().min(1).max(16_384) }),
  environment: text(80),
  captured_at: z.iso.datetime({ offset: true }),
  capture_ref: recordId.optional(),
});

export const repositoryChangeSchema = z.strictObject({
  schema_version: z.literal(1),
  id: recordId,
  entity_ids: z.array(recordId).max(64),
  change_type: z.enum(["added", "changed", "fixed", "deprecated", "removed", "reverted", "corrected"]),
  summary: text(600),
  product_impact: z.enum(["user_visible", "internal", "none"]),
  rationale: text(2_000),
  technical_summary: text(2_000),
  memory_paths: z.array(memoryPath).max(64),
  evidence: z.array(screenshot).max(16),
  issue_numbers: z.array(z.number().int().positive()).max(64).optional(),
  pull_request_numbers: z.array(z.number().int().positive()).max(64).optional(),
  reverses_change_id: recordId.optional(),
  corrects_change_id: recordId.optional(),
});

export type RepositoryEntity = z.infer<typeof repositoryEntitySchema>;
export type RepositoryChange = z.infer<typeof repositoryChangeSchema>;
export type RepositoryProjection = {
  config: z.infer<typeof repositoryConfigSchema>;
  entities: RepositoryEntity[];
  changes: RepositoryChange[];
  documents: { path: string; markdown: string }[];
};
export type RepositorySnapshotIssue = VaultIssue;

type ProjectionResult =
  | { ok: true; snapshot: RepositoryProjection }
  | { ok: false; issues: readonly RepositorySnapshotIssue[] };

type Report = (path: string, code: string, message: string) => void;

function readRecord<T>(schema: z.ZodType<T>, path: string, raw: string, report: Report): T | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    report(path, "record-json", "Provide a valid JSON record.");
    return;
  }
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const field = issue.path.join(".") || "record";
    report(path, "record-schema", "Invalid " + field + " field.");
  }
}

function checkRecordId(path: string, id: string, expected: string, ids: Set<string>, report: Report) {
  if (id !== expected) report(path, "record-filename", "The filename must match the record ID.");
  if (ids.has(id)) report(path, "record-duplicate", "The record ID already exists in this repository.");
  ids.add(id);
}

function checkPartOf(entities: ReadonlyMap<string, RepositoryEntity>, report: Report) {
  const completed = new Set<string>();
  const visiting = new Set<string>();
  const parents = (id: string) => entities.get(id)?.relations.filter((edge) => edge.type === "part_of").values();

  for (const start of entities.keys()) {
    if (completed.has(start)) continue;
    const stack = [{ id: start, parents: parents(start) }];
    visiting.add(start);
    while (stack.length) {
      const current = stack[stack.length - 1]!;
      const parent = current.parents?.next().value?.target;
      if (!parent) {
        stack.pop();
        visiting.delete(current.id);
        completed.add(current.id);
      } else if (visiting.has(parent)) {
        report(".nutshell/entities/" + current.id + ".json", "part-of-cycle", "Part-of relationships must not form a cycle.");
      } else if (entities.has(parent) && !completed.has(parent)) {
        visiting.add(parent);
        stack.push({ id: parent, parents: parents(parent) });
      }
    }
  }
}

function checkReferences(
  config: RepositoryProjection["config"],
  entities: ReadonlyMap<string, RepositoryEntity>,
  documents: ReadonlyMap<string, string>,
  report: Report,
) {
  const kinds = new Set(config.entity_kinds.map(({ slug }) => slug));
  const labels = new Set(config.entity_kinds.map(({ label }) => label.trim().toLowerCase()));
  if (kinds.size !== config.entity_kinds.length || labels.size !== config.entity_kinds.length ||
      !defaultKinds.every((kind) => kinds.has(kind))) {
    report(configPath, "entity-kinds", "Register the four default kinds and use unique slugs and labels.");
  }

  for (const entity of entities.values()) {
    const path = ".nutshell/entities/" + entity.id + ".json";
    if (!kinds.has(entity.kind)) report(path, "entity-kind", "The kind must be registered in the configuration.");
    if (entity.screen && entity.kind !== "screen") report(path, "entity-screen", "Only screen entities may declare screen routes.");
    for (const relation of entity.relations) {
      if (!entities.has(relation.target)) report(path, "entity-target", "Unknown relationship target " + relation.target + ".");
    }
    for (const memory of entity.memory_paths) {
      if (!documents.has(memory)) report(path, "memory-target", "Missing active memory document " + memory + ".");
    }
  }
  checkPartOf(entities, report);
}

export function canonicalRepositoryChange(change: RepositoryChange): string {
  return JSON.stringify(change, (_key, value: unknown) => (
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, (value as Record<string, unknown>)[key]]))
      : value
  ));
}

function checkChanges(
  entities: ReadonlyMap<string, RepositoryEntity>,
  changes: ReadonlyMap<string, RepositoryChange>,
  documents: ReadonlyMap<string, string>,
  accepted: ReadonlyMap<string, RepositoryChange> | undefined,
  report: Report,
) {
  if (accepted) {
    for (const id of [...accepted.keys()].sort()) {
      if (!changes.has(id)) {
        report(".nutshell/changes/" + id + ".json", "change-removed", "Keep the published record and add a new correction or reversal.");
      }
    }
  }

  const targetChanges = accepted ?? changes;
  const targetDescription = accepted ? "previously accepted" : "existing";
  for (const change of changes.values()) {
    const path = ".nutshell/changes/" + change.id + ".json";
    const original = accepted?.get(change.id);
    if (original) {
      // The accepted tree already validated the original entity and memory references.
      if (canonicalRepositoryChange(original) === canonicalRepositoryChange(change)) continue;
      report(path, "change-rewritten", "Keep the published payload and add a new correction or reversal.");
    }
    if (change.product_impact === "user_visible" && !change.entity_ids.length) {
      report(path, "change-impact", "A user-visible change must name an affected entity.");
    }
    if (new Set(change.entity_ids).size !== change.entity_ids.length) {
      report(path, "change-entities-duplicate", "List each affected entity once.");
    }
    for (const id of change.entity_ids) {
      if (!entities.has(id)) report(path, "change-entity", "Unknown affected entity " + id + ".");
    }
    for (const memory of change.memory_paths) {
      if (!documents.has(memory)) report(path, "memory-target", "Missing active memory document " + memory + ".");
    }
    const { change_type, reverses_change_id, corrects_change_id } = change;
    if ((change_type === "reverted") !== Boolean(reverses_change_id) ||
        (reverses_change_id && (reverses_change_id === change.id || !targetChanges.has(reverses_change_id)))) {
      report(path, "change-reversal", "A reversal must reference a different " + targetDescription + " change.");
    }
    if ((change_type === "corrected") !== Boolean(corrects_change_id) ||
        (corrects_change_id && (corrects_change_id === change.id || !targetChanges.has(corrects_change_id)))) {
      report(path, "change-correction", "A correction must reference a different " + targetDescription + " change.");
    }
  }
}

type ProjectionOptions = { acceptedChanges?: ReadonlyMap<string, RepositoryChange> };

export function projectRepositoryTree(files: ReadonlyMap<string, string>, options: ProjectionOptions = {}): ProjectionResult {
  if (files.size > 5_000) {
    return { ok: false, issues: [{ path: ".", code: "tree-size", message: "A snapshot may contain up to 5,000 paths." }] };
  }

  const issues: RepositorySnapshotIssue[] = [];
  const report: Report = (path, code, message) => {
    if (issues.length < 199) issues.push({ path, code, message });
    else if (issues.length === 199) issues.push({ path: ".", code: "issue-limit", message: "Additional validation issues were omitted." });
  };
  const documents = new Map<string, string>();
  const vaultFiles = new Map<string, string>();
  const entities = new Map<string, RepositoryEntity>();
  const changes = new Map<string, RepositoryChange>();
  const ids = new Set<string>();
  let config: RepositoryProjection["config"] | undefined;
  let managedLength = 0;

  for (const path of [...files.keys()].sort()) {
    if (!literalPath.safeParse(path).success) {
      report(path.slice(0, 512), "tree-path", "Use a safe, literal, repository-relative POSIX path.");
      continue;
    }
    const markdown = path.startsWith(vaultRoot + "/") && /\.md$/iu.test(path);
    const inRecords = path.startsWith(".nutshell/");
    if (!inRecords && !markdown && !references.includes(path)) continue;
    const source = files.get(path)!;
    managedLength += source.length;
    if (managedLength > 8 * 1024 * 1024) {
      report(".", "tree-content-size", "Managed files must total at most 8,388,608 characters.");
      return { ok: false, issues };
    }
    if (source.length > 256 * 1024) {
      report(path, "file-size", "Managed files must be at most 262,144 characters each.");
      continue;
    }
    if (!inRecords) {
      vaultFiles.set(path, source);
      // Vault validation requires inactive notes to live in archive and live notes outside it.
      if (markdown && !path.startsWith(vaultRoot + "/archive/")) documents.set(path, source);
    } else if (path === configPath) {
      config = readRecord(repositoryConfigSchema, path, source, report);
    } else {
      const [, directory, expected] = recordPath.exec(path) ?? [];
      if (directory === "entities" && expected) {
        const entity = readRecord(repositoryEntitySchema, path, source, report);
        if (entity) {
          checkRecordId(path, entity.id, expected, ids, report);
          entities.set(entity.id, entity);
        }
      } else if (directory === "changes" && expected) {
        const change = readRecord(repositoryChangeSchema, path, source, report);
        if (change) {
          checkRecordId(path, change.id, expected, ids, report);
          changes.set(change.id, change);
        }
      } else {
        report(path, "record-path", "Use the fixed configuration, entity, and change record locations.");
      }
    }
  }

  for (const path of references) {
    if (!files.has(path)) report(path, "handoff-missing", "The repository must include this handoff file.");
  }
  for (const issue of validateVault(vaultFiles)) report(issue.path, issue.code, issue.message);
  if (!files.has(configPath)) report(configPath, "config-missing", "The repository must include a configuration record.");
  if (config) {
    checkReferences(config, entities, documents, report);
    checkChanges(entities, changes, documents, options.acceptedChanges, report);
  }
  if (!config || issues.length) return { ok: false, issues };

  return { ok: true, snapshot: {
    config,
    entities: [...entities.values()],
    changes: [...changes.values()],
    documents: [...documents].map(([path, markdown]) => ({ path, markdown })),
  } };
}
