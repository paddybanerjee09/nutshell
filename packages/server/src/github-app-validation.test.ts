import { buildFixtureSetupTree } from "@nutshell/core/fixture-setup-tree";
import type { RepositoryChange } from "@nutshell/core/snapshot";
import { describe, expect, it, vi } from "vitest";
import type { GitHubAppRepository, GitHubRepositoryIdentity } from "./github-app-repository.ts";
import { createGitHubAppValidation } from "./github-app-validation.ts";

const identity: GitHubRepositoryIdentity = {
  id: 91, nodeId: "repo_91", installationId: 25, ownerId: 40,
  owner: "example", name: "field-notes", defaultBranch: "main",
};
const baseRevision = "a".repeat(40);
const headRevision = "b".repeat(40);
const sourcePath = "src/worker.ts";
const configPath = ".nutshell/config.json";
const eventPath = ".nutshell/changes/chg_worker_cleanup.json";

function candidate() {
  const prepared = buildFixtureSetupTree([{ path: sourcePath, body: "export const interval = 1000;\n" }], {
    entityId: "ent_worker", name: "Field Notes", description: "A local fixture repository.",
  });
  const baseFiles = new Map(prepared.map(({ path, body }) => [path, body]));
  const headFiles = new Map(baseFiles);
  headFiles.set(sourcePath, "export const interval = 2000;\n");
  return { baseRevision, headRevision, baseFiles, headFiles };
}

function repository() {
  return {
    readPullRequestComparison: vi.fn<GitHubAppRepository["readPullRequestComparison"]>(),
    publishPullRequestCheck: vi.fn<GitHubAppRepository["publishPullRequestCheck"]>(),
  };
}

describe("live GitHub PR validation", () => {
  it("publishes a passing Check for classified changes on the exact requested head and base", async () => {
    const comparison = candidate();
    const provider = repository();
    comparison.headFiles.set(eventPath, JSON.stringify({
      schema_version: 1, id: "chg_worker_cleanup", entity_ids: ["ent_worker"], change_type: "changed",
      summary: "Reduce polling frequency for the local fixture worker.",
      rationale: "Cut unnecessary database polling during idle periods.",
      technical_summary: "Increase the poll interval for the worker.",
      product_impact: "internal", memory_paths: [], evidence: [],
    }));
    provider.readPullRequestComparison.mockResolvedValue({ ...comparison, changedPaths: [sourcePath, eventPath] });
    provider.publishPullRequestCheck.mockResolvedValue({ id: 72, head: headRevision, status: "completed", conclusion: "success" });

    const input = { pullNumber: 7, expectedHead: headRevision.toUpperCase(), expectedBase: baseRevision.toUpperCase() };
    const result = await createGitHubAppValidation(provider).validatePullRequest(identity, input);
    expect(provider.readPullRequestComparison).toHaveBeenCalledExactlyOnceWith(identity, input);
    expect(provider.publishPullRequestCheck).toHaveBeenCalledExactlyOnceWith(identity, {
      pullNumber: 7, expectedHead: headRevision, expectedBase: baseRevision,
      conclusion: "success", summary: expect.stringContaining(`Trusted base: ${baseRevision}`),
    });
    expect(result.validation).toMatchObject({ ok: true, policyVersion: 1 });
    expect(result.check.conclusion).toBe("success");
  });

  it("preserves an old memory reference when the connected service supplies accepted history", async () => {
    const { baseFiles } = candidate();
    const accepted: RepositoryChange = {
      schema_version: 1, id: "chg_worker_cleanup", entity_ids: ["ent_worker"], change_type: "changed",
      summary: "Reduce polling frequency for the local fixture worker.",
      rationale: "Cut unnecessary database polling during idle periods.",
      technical_summary: "Increase the poll interval for the worker.",
      product_impact: "internal", memory_paths: ["nutshell-vault/features/old/CONTEXT.md"], evidence: [],
    };
    baseFiles.set(eventPath, JSON.stringify(accepted));
    const provider = repository();
    provider.readPullRequestComparison.mockResolvedValue({
      baseRevision, headRevision, baseFiles, headFiles: new Map(baseFiles), changedPaths: [],
    });
    provider.publishPullRequestCheck.mockResolvedValue({ id: 74, head: headRevision, status: "completed", conclusion: "success" });
    const result = await createGitHubAppValidation(provider).validatePullRequest(identity, { pullNumber: 7, expectedHead: headRevision },
      new Map([[accepted.id, accepted]]));
    expect(result.validation.ok).toBe(true);
    expect(provider.publishPullRequestCheck).toHaveBeenCalledWith(identity, expect.objectContaining({ conclusion: "success" }));
  });

  it("publishes failure when the candidate tries to remove coverage for its unclassified code change", async () => {
    const comparison = candidate();
    const provider = repository();
    const config = JSON.parse(comparison.baseFiles.get(configPath)!);
    comparison.headFiles.set(configPath, JSON.stringify({ ...config, coverage: { include: [], exclude: [sourcePath] } }));
    provider.readPullRequestComparison.mockResolvedValue({ ...comparison, changedPaths: [sourcePath, configPath] });
    provider.publishPullRequestCheck.mockResolvedValue({ id: 73, head: headRevision, status: "completed", conclusion: "failure" });

    const result = await createGitHubAppValidation(provider).validatePullRequest(identity, { pullNumber: 7, expectedHead: headRevision });
    expect(result.validation.ok).toBe(false);
    expect(result.validation.mappings).toContainEqual(expect.objectContaining({ path: sourcePath, covered: true }));
    expect(provider.publishPullRequestCheck).toHaveBeenCalledExactlyOnceWith(identity, {
      pullNumber: 7, expectedHead: headRevision, expectedBase: baseRevision,
      conclusion: "failure", summary: expect.stringContaining("Diagnostics:"),
    });
  });

  it("does not publish a Check for moved or unavailable comparison evidence", async () => {
    const provider = repository();
    provider.readPullRequestComparison.mockResolvedValue({ ...candidate(), headRevision: "c".repeat(40), changedPaths: [] });
    const validation = createGitHubAppValidation(provider);
    await expect(validation.validatePullRequest(identity, { pullNumber: 7, expectedHead: headRevision })).rejects
      .toMatchObject({ code: "conflict" });
    provider.readPullRequestComparison.mockRejectedValue(new Error("Comparison unavailable"));
    await expect(validation.validatePullRequest(identity, { pullNumber: 7, expectedHead: headRevision })).rejects
      .toThrow("Comparison unavailable");
    expect(provider.publishPullRequestCheck).not.toHaveBeenCalled();
  });
});
