import { z } from "zod";
import { noteMetadataFields, parseFrontmatter } from "./frontmatter.ts";
import type { VaultIssue } from "./vault.ts";

const path = "nutshell-vault/CURRENT_TASK.md";
const positiveInt = z.int().positive();
const nonempty = z.string().min(1).refine((value) => value === value.trim());
const taskId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/u);
const oid = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const prUrl = z.string().regex(/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9]\d*$/u);

const taskIdentity = [
  "task_id", "repository_id", "branch", "base_branch", "lead_agent", "integration_checkout",
] as const;
const taskAssociations = [
  ...taskIdentity, "pr_number", "pr_url", "last_verified_head", "cleanup_pr_url",
] as const;
const prOpenStates = new Set(["pr_open", "ready_for_review", "cleanup_pending"]);

const sourceTaskSchema = z.strictObject({
  ...noteMetadataFields,
  status: z.literal("active"),
  task_id: taskId.nullable(),
  task_state: z.enum(["idle", "in_progress", "pr_open", "ready_for_review", "blocked", "cleanup_pending"]),
  task_revision: z.int().min(0),
  repository_id: positiveInt.nullable(),
  branch: nonempty.nullable(),
  base_branch: nonempty.nullable(),
  pr_number: positiveInt.nullable(),
  pr_url: prUrl.nullable(),
  lead_agent: nonempty.nullable(),
  integration_checkout: nonempty.nullable(),
  last_verified_head: oid.nullable(),
  cleanup_pr_url: prUrl.nullable(),
}).superRefine((task, context) => {
  function issue(field: string, message: string) {
    context.addIssue({ code: "custom", path: [field], message });
  }
  if (task.task_state === "idle") {
    for (const field of taskAssociations) {
      if (task[field] !== null) issue(field, "Idle tasks must clear this field.");
    }
    return;
  }
  if (task.task_revision === 0) issue("task_revision", "Active tasks require a positive revision.");
  for (const field of taskIdentity) {
    if (task[field] === null) issue(field, "Active tasks require this field.");
  }
  if (task.branch === task.base_branch) issue("branch", "Feature and base branches must differ.");
  if ((task.pr_number === null) !== (task.pr_url === null)) {
    issue("pr_number", "Record the PR number and URL together.");
  } else if (task.pr_url && !task.pr_url.endsWith("/pull/" + task.pr_number)) {
    issue("pr_url", "The URL must reference the recorded PR number.");
  } else if (prOpenStates.has(task.task_state) && task.pr_number === null) {
    issue("pr_number", "This state requires an observed PR.");
  }
  if (task.cleanup_pr_url !== null && task.task_state !== "cleanup_pending") {
    issue("cleanup_pr_url", "Only a pending cleanup can reference a cleanup PR.");
  }
});

type SourceTask = z.infer<typeof sourceTaskSchema>;

export type SourceFeatureEvidence = {
  repositoryId: number;
  baseBranch: string;
  headBranch: string;
  prNumber: number;
  prUrl: string;
  taskId: string;
};

export type SourceHousekeepingEvidence = SourceFeatureEvidence & {
  merged: boolean;
  testedFeatureHead: string;
  observedFeatureHead: string;
  expectedMainHead: string;
  currentMainHead: string;
  expectedTaskBlob: string;
  currentTaskBlob: string;
  expectedTaskRevision: number;
  changedPaths: readonly string[];
};

type Report = (code: string, message: string) => void;

function readTask(source: string, snapshot: string, report: Report) {
  const parsed = parseFrontmatter(source);
  if (!parsed.ok) {
    report("task-frontmatter", snapshot + ": " + parsed.message);
    return;
  }
  const result = sourceTaskSchema.safeParse(parsed.data);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const field = issue.path.join(".");
    report("task-metadata", snapshot + (field ? " " + field : "") + ": " + issue.message);
  }
}

function checkFeatureIdentity(task: SourceTask, evidence: SourceFeatureEvidence, report: Report) {
  if (task.task_id !== evidence.taskId ||
      task.repository_id !== evidence.repositoryId ||
      task.branch !== evidence.headBranch ||
      task.base_branch !== evidence.baseBranch ||
      task.pr_number !== evidence.prNumber ||
      task.pr_url !== evidence.prUrl) {
    report("task-pr-mismatch", "Task identity must match the observed repository, PR, branches, and task marker.");
  }
}

// The caller binds both task snapshots to the provider-observed Git revisions.
export function validateSourceFeature(
  base: string,
  proposed: string,
  evidence: SourceFeatureEvidence,
): VaultIssue[] {
  const issues: VaultIssue[] = [];
  const report: Report = (code, message) => { issues.push({ path, code, message }); };
  const current = readTask(base, "Canonical task", report);
  const feature = readTask(proposed, "Feature task", report);
  if (!current || !feature) return issues;

  if (current.task_state !== "idle") {
    report("task-base-active", "Canonical task must be idle before another feature PR can advance.");
  }
  if (feature.task_state === "idle" || feature.task_state === "blocked" || feature.task_state === "cleanup_pending") {
    report("task-feature-state", "The feature PR must carry an open, advancing task.");
  }
  if (feature.id !== current.id) {
    report("task-stable-id", "Preserve the stable task-file ID.");
  }
  if (feature.task_revision <= current.task_revision) {
    report("task-revision", "The feature task revision must advance the canonical revision.");
  }
  if (feature.pr_number === null) {
    report("task-pr-mismatch", "The feature task requires an observed PR number and URL.");
  } else {
    checkFeatureIdentity(feature, evidence, report);
  }
  return issues;
}

function matchesObjectId(expected: string, observed: string) {
  return expected === observed && oid.safeParse(expected).success;
}

// Source callers must obtain authenticated provider evidence and enforce the
// expected head at the write boundary. This check is read-only.
export function validateHousekeeping(
  current: string,
  proposed: string,
  evidence: SourceHousekeepingEvidence,
): VaultIssue[] {
  const issues: VaultIssue[] = [];
  const report: Report = (code, message) => { issues.push({ path, code, message }); };
  const active = readTask(current, "Canonical task", report);
  const idle = readTask(proposed, "Cleanup task", report);
  if (!active || !idle) return issues;

  if (evidence.merged !== true || !matchesObjectId(evidence.testedFeatureHead, evidence.observedFeatureHead)) {
    report("cleanup-merge-unverified", "Confirm that the exact tested feature head merged on GitHub.");
  }
  if (!matchesObjectId(evidence.expectedMainHead, evidence.currentMainHead) ||
      !matchesObjectId(evidence.expectedTaskBlob, evidence.currentTaskBlob) ||
      active.task_revision !== evidence.expectedTaskRevision) {
    report("cleanup-stale", "The canonical head, task blob, and revision must match the captured task.");
  }
  if (evidence.changedPaths.length !== 1 || evidence.changedPaths[0] !== path) {
    report("cleanup-path", "Housekeeping may change only the named task file.");
  }
  if (active.task_state === "idle" || idle.task_state !== "idle") {
    report("cleanup-state", "Housekeeping must advance an active canonical task to idle.");
  }
  checkFeatureIdentity(active, evidence, report);
  if (idle.task_revision !== active.task_revision + 1) {
    report("task-revision", "Housekeeping must advance the task revision by one.");
  }
  if (idle.id !== active.id || JSON.stringify(idle.tags) !== JSON.stringify(active.tags)) {
    report("task-stable-id", "Housekeeping must preserve the stable task-file ID and control tags.");
  }
  return issues;
}
