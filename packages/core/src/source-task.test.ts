import { describe, expect, it } from "vitest";
import { validateHousekeeping, validateSourceFeature } from "./source-task.ts";
import type { SourceFeatureEvidence, SourceHousekeepingEvidence } from "./source-task.ts";

const path = "nutshell-vault/CURRENT_TASK.md";
const feature = {
  repositoryId: 123,
  baseBranch: "main",
  headBranch: "feature/local-search",
  prNumber: 81,
  prUrl: "https://github.com/example/nutshell/pull/81",
  taskId: "local-search-2026-11-26",
} satisfies SourceFeatureEvidence;

const idle = {
  id: "control-current-task",
  date: "2026-11-26",
  status: "active",
  tags: ["control", "task", "pull-requests"],
  task_id: null,
  task_state: "idle",
  task_revision: 4,
  repository_id: null,
  branch: null,
  base_branch: null,
  pr_number: null,
  pr_url: null,
  lead_agent: null,
  integration_checkout: null,
  last_verified_head: null,
  cleanup_pr_url: null,
};
const open = {
  ...idle,
  task_id: feature.taskId,
  task_state: "pr_open",
  task_revision: 6,
  repository_id: feature.repositoryId,
  branch: feature.headBranch,
  base_branch: feature.baseBranch,
  pr_number: feature.prNumber,
  pr_url: feature.prUrl,
  lead_agent: "lead",
  integration_checkout: "C:\\example\\nutshell",
};
const cleared = { ...idle, task_revision: 7 };
const housekeeping = {
  ...feature,
  merged: true,
  testedFeatureHead: "a".repeat(40),
  observedFeatureHead: "a".repeat(40),
  expectedMainHead: "b".repeat(40),
  currentMainHead: "b".repeat(40),
  expectedTaskBlob: "c".repeat(40),
  currentTaskBlob: "c".repeat(40),
  expectedTaskRevision: open.task_revision,
  changedPaths: [path],
} satisfies SourceHousekeepingEvidence;

function task(fields: Record<string, unknown>) {
  return "---\n" + JSON.stringify(fields) + "\n---\n\n# Current task\n";
}

describe("source feature task", () => {
  it("binds a revised active task to the observed feature PR", () => {
    expect(validateSourceFeature(task(idle), task(open), feature)).toEqual([]);
  });

  it("permits the initial idle revision zero", () => {
    expect(validateSourceFeature(task({ ...idle, task_revision: 0 }), task(open), feature)).toEqual([]);
  });

  it("checks stable metadata, nullable fields, and positive task revisions", () => {
    for (const fields of [
      { ...open, status: "planned" },
      { ...open, pr_number: null, pr_url: null },
      { ...open, pr_url: null },
      { ...open, pr_url: "https://github.com/example/nutshell/pull/82" },
      { ...open, task_revision: 0 },
      { ...open, task_revision: 1.5 },
      { ...open, integration_checkout: null },
      { ...open, cleanup_pr_url: "https://github.com/example/nutshell/pull/82" },
    ]) {
      expect(validateSourceFeature(task(idle), task(fields), feature)).toContainEqual(
        expect.objectContaining({ path, code: "task-metadata" }),
      );
    }
  });

  it("rejects alias-based overrides on a task file", () => {
    const malicious = "---\ntask_id: &id local-search\ntask_id: *id\n---\n";
    expect(validateSourceFeature(task(idle), malicious, feature)).toContainEqual(
      expect.objectContaining({ path, code: "task-frontmatter" }),
    );
  });

  it("rejects concurrent features, inactive proposals, and stale revisions", () => {
    expect(validateSourceFeature(task(open), task({ ...open, task_revision: 7 }), feature)).toContainEqual(
      expect.objectContaining({ path, code: "task-base-active" }),
    );
    for (const inactive of [cleared, { ...open, task_state: "blocked" }, { ...open, task_state: "cleanup_pending" }]) {
      expect(validateSourceFeature(task(idle), task(inactive), feature)).toContainEqual(
        expect.objectContaining({ path, code: "task-feature-state" }),
      );
    }
    expect(validateSourceFeature(task(idle), task({ ...open, task_revision: 4 }), feature)).toContainEqual(
      expect.objectContaining({ path, code: "task-revision" }),
    );
    expect(validateSourceFeature(task(idle), task({ ...open, id: "replacement-control" }), feature)).toContainEqual(
      expect.objectContaining({ path, code: "task-stable-id" }),
    );
  });

  it("rejects any different GitHub identity field", () => {
    for (const different of [
      { repositoryId: 456 },
      { taskId: "changed-task-marker" },
      { baseBranch: "release" },
      { headBranch: "feature/elsewhere" },
      { prNumber: 82 },
      { prUrl: "https://github.com/example/other-repo/pull/81" },
    ]) {
      expect(validateSourceFeature(task(idle), task(open), { ...feature, ...different })).toContainEqual(
        expect.objectContaining({ path, code: "task-pr-mismatch" }),
      );
    }
  });
});

describe("source housekeeping", () => {
  it("accepts only an incremented idle reset for a verified, matching merge", () => {
    expect(validateHousekeeping(task(open), task(cleared), housekeeping)).toEqual([]);
  });

  it("rejects closed-unmerged PRs and unverified or empty feature heads", () => {
    for (const different of [
      { merged: false },
      { observedFeatureHead: "d".repeat(40) },
      { testedFeatureHead: "", observedFeatureHead: "" },
    ]) {
      expect(validateHousekeeping(task(open), task(cleared), { ...housekeeping, ...different })).toContainEqual(
        expect.objectContaining({ path, code: "cleanup-merge-unverified" }),
      );
    }
  });

  it("rejects stale heads, blobs, revisions, and merge identities", () => {
    for (const stale of [
      { currentMainHead: "d".repeat(40) },
      { currentTaskBlob: "d".repeat(40) },
      { expectedTaskRevision: 5 },
    ]) {
      expect(validateHousekeeping(task(open), task(cleared), { ...housekeeping, ...stale })).toContainEqual(
        expect.objectContaining({ path, code: "cleanup-stale" }),
      );
    }
    expect(validateHousekeeping(task(open), task(cleared), { ...housekeeping, prNumber: 80 })).toContainEqual(
      expect.objectContaining({ path, code: "task-pr-mismatch" }),
    );
  });

  it("makes repeated cleanup and wrong paths fail closed", () => {
    expect(validateHousekeeping(task(cleared), task({ ...idle, task_revision: 8 }), housekeeping)).toContainEqual(
      expect.objectContaining({ path, code: "cleanup-state" }),
    );
    for (const changedPaths of [[], [path, path], [path, "README.md"]]) {
      expect(validateHousekeeping(task(open), task(cleared), { ...housekeeping, changedPaths })).toContainEqual(
        expect.objectContaining({ path, code: "cleanup-path" }),
      );
    }
  });

  it("clears every association and preserves the control metadata", () => {
    expect(validateHousekeeping(task(open), task({ ...cleared, task_id: open.task_id }), housekeeping)).toContainEqual(
      expect.objectContaining({ path, code: "task-metadata" }),
    );
    expect(validateHousekeeping(task(open), task({ ...cleared, tags: ["other"] }), housekeeping)).toContainEqual(
      expect.objectContaining({ path, code: "task-stable-id" }),
    );
    expect(validateHousekeeping(task(open), task({ ...cleared, task_revision: 8 }), housekeeping)).toContainEqual(
      expect.objectContaining({ path, code: "task-revision" }),
    );
  });
});
