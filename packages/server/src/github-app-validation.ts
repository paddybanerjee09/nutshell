import { validateRepositoryChanges } from "@nutshell/core/change-validation";
import type { RepositoryChange } from "@nutshell/core/snapshot";
import { GitHubRepositoryError, type GitHubAppRepository, type GitHubRepositoryIdentity } from "./github-app-repository.ts";

type ValidationRepository = Pick<GitHubAppRepository, "readPullRequestComparison" | "publishPullRequestCheck">;
type ComparisonInput = Parameters<ValidationRepository["readPullRequestComparison"]>[1];

function checkSummary(baseRevision: string, validation: ReturnType<typeof validateRepositoryChanges>) {
  const errors = validation.issues.filter(({ severity }) => severity === "error").length;
  const warnings = validation.issues.length - errors;
  const covered = validation.mappings.filter(({ covered }) => covered).length;
  const issueCodes = [...new Set(validation.issues.map(({ code }) => code))].slice(0, 16);
  const summary = [
    `Trusted base: ${baseRevision}`,
    `Policy version ${validation.policyVersion} reviewed ${covered} covered paths with ${errors} errors and ${warnings} warnings.`,
  ];
  if (issueCodes.length) summary.push("Diagnostics: " + issueCodes.join(", "));
  return summary.join("\n\n");
}

export function createGitHubAppValidation(repository: ValidationRepository) {
  return {
    async validatePullRequest(identity: GitHubRepositoryIdentity, input: ComparisonInput,
      acceptedChanges?: ReadonlyMap<string, RepositoryChange>) {
      const comparison = await repository.readPullRequestComparison(identity, input);
      if (comparison.headRevision !== input.expectedHead.toLowerCase() ||
          (input.expectedBase !== undefined && comparison.baseRevision !== input.expectedBase.toLowerCase())) {
        throw new GitHubRepositoryError("conflict", "The pull request comparison no longer matches the requested revisions.");
      }
      const { baseFiles, headFiles, changedPaths } = comparison;
      const validation = validateRepositoryChanges({ baseFiles, headFiles, changedPaths, acceptedChanges });
      const check = await repository.publishPullRequestCheck(identity, {
        pullNumber: input.pullNumber,
        expectedBase: comparison.baseRevision,
        expectedHead: comparison.headRevision,
        conclusion: validation.ok ? "success" : "failure",
        summary: checkSummary(comparison.baseRevision, validation),
      });
      return { baseRevision: comparison.baseRevision, headRevision: comparison.headRevision, validation, check };
    },
  };
}
