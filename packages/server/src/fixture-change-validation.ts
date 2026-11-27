import { validateRepositoryChanges } from "@nutshell/core/change-validation";
import { readAcceptedFixtureChanges } from "./fixture-history-store.ts";
import type { FixtureFile } from "./fixture-sync.ts";
import type { FixtureTransaction } from "./runtime.ts";

export async function validateFixtureProposedChanges(
  tx: FixtureTransaction, repositoryId: number, original: readonly FixtureFile[], candidate: readonly FixtureFile[],
) {
  const baseFiles = new Map(original.map(({ path, body }) => [path, body]));
  const headFiles = new Map(candidate.map(({ path, body }) => [path, body]));
  const inventory = new Set([...baseFiles.keys(), ...headFiles.keys()]);
  const changedPaths = [...inventory].filter((path) => baseFiles.get(path) !== headFiles.get(path));
  const acceptedChanges = await readAcceptedFixtureChanges(tx, repositoryId);
  return validateRepositoryChanges({ baseFiles, headFiles, changedPaths, acceptedChanges });
}
