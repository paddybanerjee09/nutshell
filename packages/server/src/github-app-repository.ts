import { createHash } from "node:crypto";
import { z } from "zod";
import { GitHubTransportError, type GitHubAppTransport, type GitHubInstallationPermissions } from "./github-app-transport.ts";

const maxTreeEntries = 5_000;
const maxManagedFiles = 400;
const maxBlobBytes = 256 * 1024;
const maxTreeBytes = 8 * 1024 * 1024;
const maxDiscoveryInstallations = 20;
const maxConnectionCandidates = 500;
const handoffPaths = new Set(["AGENTS.md", "README.md", "SPEC.md"]);
export const githubValidationCheckName = "Nutshell validation";

const numericId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const objectId = z.string().regex(/^(?:[a-f\d]{40}|[a-f\d]{64})$/iu).transform((value) => value.toLowerCase());
const login = z.string().regex(/^[a-z\d][a-z\d_-]{0,99}$/iu);
const name = z.string().regex(/^[a-z\d_.-]{1,100}$/iu).refine((value) => value !== "." && value !== "..");
const nodeId = z.string().min(1).max(256).refine((value) => value.isWellFormed() && !/[\s\p{Cc}]/u.test(value));
const gitBranch = z.string().min(1).max(255).refine((value) => value.isWellFormed() && value !== "@"
  && !/[\s\\~^:?*[\p{Cc}]/u.test(value) && !value.includes("..") && !value.includes("@{")
  && !value.endsWith(".") && value.split("/").every((segment) => segment && !segment.startsWith(".") && !segment.endsWith(".lock")));
const treePath = z.string().min(1).max(512).refine((value) => value.isWellFormed()
  && !/[\\:<>"|?*[\]{}\p{Cc}]|%(?:00|2e|2f|5c)/iu.test(value)
  && value.split("/").length <= 32
  && value.split("/").every((segment) => segment && !/[. ]$/u.test(segment) && !/^(?:\.git|git~1)$/iu.test(segment)));

const account = z.object({ id: numericId, login });
const appIdentity = z.object({ id: numericId, slug: z.string().regex(/^[a-z\d][a-z\d-]{0,99}$/u) });
const installation = z.object({
  id: numericId, app_id: numericId, account, suspended_at: z.string().nullable(),
  target_type: z.enum(["User", "Organization"]),
});
const repository = z.object({
  id: numericId, node_id: nodeId, owner: account, name, default_branch: gitBranch,
  private: z.boolean(), archived: z.boolean(), disabled: z.boolean(),
});
const userRepository = repository.extend({ permissions: z.object({ pull: z.boolean(), push: z.boolean(), admin: z.boolean() }) });
const standardRole = z.enum(["read", "triage", "write", "maintain", "admin"]);
const permission = z.object({ user: account, role_name: z.string().min(1).max(120), permission: z.string().min(1).max(20) });
const revisionReference = z.object({ ref: z.string().max(300), object: z.object({ type: z.literal("commit"), sha: objectId }) });
const commit = z.object({ sha: objectId, tree: z.object({ sha: objectId }) });
const treeEntry = z.object({
  path: treePath, mode: z.string().max(6), type: z.enum(["tree", "blob", "commit"]), sha: objectId,
  size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
});
const repositoryTree = z.object({ sha: objectId, truncated: z.boolean(), tree: z.array(treeEntry).max(maxTreeEntries) });
const blob = z.object({ sha: objectId, size: z.number().int().nonnegative().max(maxBlobBytes), encoding: z.literal("base64"),
  content: z.string().max(Math.ceil(maxBlobBytes / 3) * 5), });
const pullEndpoint = z.object({
  number: numericId, state: z.enum(["open", "closed"]),
  head: z.object({ sha: objectId, ref: gitBranch.optional(), repo: z.object({ id: numericId }).nullable() }),
  base: z.object({ sha: objectId.optional(), ref: gitBranch, repo: z.object({ id: numericId }) }),
});
const checkRun = z.object({
  id: numericId, name: z.string().max(100), head_sha: objectId, app: z.object({ id: numericId }).nullable(),
  status: z.enum(["queued", "in_progress", "completed", "waiting", "requested", "pending"]),
  conclusion: z.enum(["action_required", "cancelled", "failure", "neutral", "skipped", "stale", "startup_failure", "success", "timed_out"]).nullable(),
});
const rule = z.object({ type: z.string().max(100), parameters: z.unknown().optional() });
const requiredChecks = z.object({ required_status_checks: z.array(z.object({
  context: z.string().max(200), integration_id: z.number().int().nullish(),
})).max(100) });

type GitHubRepositoryRole = z.infer<typeof standardRole>;
export type GitHubRepositoryIdentity = {
  id: number; nodeId: string; installationId: number; ownerId: number; owner: string; name: string; defaultBranch: string;
};
export type GitHubRepositoryAccess = {
  identity: GitHubRepositoryIdentity;
  userId: number;
  role: GitHubRepositoryRole;
  canRead: true;
  canWrite: boolean;
  canConfigure: boolean;
};
export type GitHubConnectionCandidate = { repositoryId: number; installationId: number; owner: string; name: string };
type GitHubImmutableTree = { treeSha: string; paths: readonly string[]; files: readonly { path: string; body: string }[] };
type TrackedTreeEntry = z.infer<typeof treeEntry>;
type GitHubPullTarget = { pullNumber: number; expectedHead: string; expectedBase?: string };
type GitHubCheckInput = GitHubPullTarget & { conclusion: "success" | "failure"; summary: string };
export type GitHubPullComparison = {
  baseRevision: string;
  headRevision: string;
  baseFiles: ReadonlyMap<string, string>;
  headFiles: ReadonlyMap<string, string>;
  changedPaths: readonly string[];
};
type GitHubValidationStatus = { id: number; head: string; status: z.infer<typeof checkRun>["status"]; conclusion: z.infer<typeof checkRun>["conclusion"] };
type GitHubBranchCheckEnforcement = { rule: "required" | "unknown"; bypass: "unknown" };

export class GitHubRepositoryError extends Error {
  readonly code: "invalid_request" | "invalid_response" | "conflict" | "unsupported" | "limit";
  constructor(code: GitHubRepositoryError["code"], message: string) {
    super(message);
    this.name = "GitHubRepositoryError";
    this.code = code;
  }
}

function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new GitHubRepositoryError("invalid_response", "GitHub returned an unexpected repository response.");
  return result.data;
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new GitHubRepositoryError("invalid_request", "Use a valid repository or exact Git object identity.");
  return result.data;
}

function uniqueId(rows: readonly unknown[], expectedId: number): unknown {
  const matches = rows.filter((row) => typeof row === "object" && row !== null && "id" in row && row.id === expectedId);
  if (matches.length > 1) throw new GitHubRepositoryError("invalid_response", "GitHub returned duplicate identities.");
  return matches[0];
}

function repositoryPath(owner: string, repoName: string) {
  return `/repos/${parseInput(login, owner)}/${parseInput(name, repoName)}`;
}

function hasIdentity(actual: z.infer<typeof repository>, expected: GitHubRepositoryIdentity) {
  return actual.id === expected.id && actual.node_id === expected.nodeId && actual.owner.id === expected.ownerId
    && actual.owner.login.toLowerCase() === expected.owner.toLowerCase() && actual.name.toLowerCase() === expected.name.toLowerCase()
    && actual.default_branch === expected.defaultBranch && actual.private && !actual.disabled;
}

function scope(identity: GitHubRepositoryIdentity, permissions: GitHubInstallationPermissions) {
  return { installationId: parseInput(numericId, identity.installationId), repositoryIds: [parseInput(numericId, identity.id)], permissions };
}

function isManaged(path: string) {
  return handoffPaths.has(path) || path.startsWith(".nutshell/") || (path.startsWith("nutshell-vault/") && /\.md$/iu.test(path));
}

function isManagedArea(path: string) {
  return isManaged(path) || path === ".nutshell" || path === "nutshell-vault" || path.startsWith("nutshell-vault/");
}

function listTracked(tree: readonly TrackedTreeEntry[]) {
  const entries = new Map<string, TrackedTreeEntry>();
  for (const entry of tree) {
    const { path, type, mode } = entry;
    if (entries.has(path) || (type === "tree" && mode !== "040000") || (type === "commit" && mode !== "160000")
      || (type === "blob" && mode !== "100644" && mode !== "100755" && mode !== "120000")) {
      throw new GitHubRepositoryError("invalid_response", "GitHub returned inconsistent Git tree entries.");
    }
    if ((isManagedArea(path) && (mode === "120000" || type === "commit"))
      || (handoffPaths.has(path) && type === "tree") || ((path === ".nutshell" || path === "nutshell-vault") && type !== "tree")) {
      throw new GitHubRepositoryError("unsupported", "Managed paths must use regular files and directories.");
    }
    entries.set(path, entry);
  }
  for (const path of entries.keys()) {
    for (let separator = path.lastIndexOf("/"); separator > 0; separator = path.lastIndexOf("/", separator - 1)) {
      const parent = entries.get(path.slice(0, separator));
      if (parent && parent.type !== "tree") throw new GitHubRepositoryError("invalid_response", "A Git tree path is nested below a tracked file.");
    }
  }
  return [...entries.keys()].sort().flatMap((path) => {
    const entry = entries.get(path)!;
    return entry.type === "tree" ? [] : [entry];
  });
}

function compareTrackedPaths(base: readonly TrackedTreeEntry[], head: readonly TrackedTreeEntry[]) {
  const original = new Map(base.map((entry) => [entry.path, entry]));
  const changed: string[] = [];
  for (const entry of head) {
    const before = original.get(entry.path);
    if (!before || before.sha !== entry.sha || before.mode !== entry.mode || before.type !== entry.type) changed.push(entry.path);
    original.delete(entry.path);
  }
  // Rename endpoints both participate in coverage, the same as a removal plus an addition.
  return [...changed, ...original.keys()].sort();
}

function comparisonFiles(tracked: readonly TrackedTreeEntry[], files: GitHubImmutableTree["files"]) {
  // Keep inventory keys for coverage and glob matching without reading unmanaged blobs.
  const result = new Map(tracked.map(({ path }) => [path, ""]));
  for (const { path, body } of files) result.set(path, body);
  return result;
}

function decodeBlob(value: unknown, sha: string, size: number): string {
  const result = parseResponse(blob, value);
  const encoded = result.content.replaceAll(/[\r\n]/gu, "");
  if (result.sha !== sha || result.size !== size || encoded.length !== Math.ceil(size / 3) * 4) {
    throw new GitHubRepositoryError("invalid_response", "GitHub returned a different Git blob.");
  }
  const bytes = Buffer.from(encoded, "base64");
  const hash = createHash(sha.length === 40 ? "sha1" : "sha256").update(`blob ${size}\0`).update(bytes).digest("hex");
  if (bytes.length !== size || bytes.toString("base64") !== encoded || hash !== sha) {
    throw new GitHubRepositoryError("invalid_response", "Git blob bytes do not match the immutable tree.");
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    if (text.includes("\0")) throw new Error();
    return text;
  } catch {
    throw new GitHubRepositoryError("unsupported", "Managed Git files must contain valid UTF-8 text without null characters.");
  }
}

export function createGitHubAppRepository(transport: GitHubAppTransport) {
  async function discoverConnections(userToken: string) {
    const signal = AbortSignal.timeout(20_000);
    const [appReply, actorReply, installationRows] = await Promise.all([
      transport.appRequest("/app", { signal }),
      transport.userRequest(userToken, "/user", { signal }),
      transport.userPages(userToken, "/user/installations?per_page=100", {
        key: "installations", maxItems: maxDiscoveryInstallations, signal,
      }),
    ]);
    const app = parseResponse(appIdentity, appReply);
    const actor = parseResponse(account, actorReply);
    if (app.id !== transport.appId) throw new GitHubRepositoryError("invalid_response", "GitHub returned a different App identity.");
    const seenInstallations = new Set<number>();
    const candidates = new Map<number, GitHubConnectionCandidate>();
    for (const row of installationRows) {
      const installed = parseResponse(installation, row);
      if (seenInstallations.has(installed.id)) throw new GitHubRepositoryError("invalid_response", "GitHub repeated an installation identity.");
      seenInstallations.add(installed.id);
      if (installed.app_id !== app.id || installed.suspended_at !== null) continue;
      const repositories = await transport.userPages(userToken, `/user/installations/${installed.id}/repositories?per_page=100`, {
        key: "repositories", maxItems: maxConnectionCandidates, signal,
      });
      for (const value of repositories) {
        const repo = parseResponse(userRepository, value);
        if (!repo.permissions.pull || !repo.private || repo.disabled || repo.owner.id !== installed.account.id ||
            repo.owner.login.toLowerCase() !== installed.account.login.toLowerCase()) continue;
        if (candidates.has(repo.id)) throw new GitHubRepositoryError("invalid_response", "GitHub repeated a repository identity.");
        if (candidates.size >= maxConnectionCandidates) throw new GitHubRepositoryError("limit", "Too many GitHub repositories to list.");
        candidates.set(repo.id, { repositoryId: repo.id, installationId: installed.id, owner: repo.owner.login, name: repo.name });
      }
    }
    return { userId: actor.id, installationUrl: `https://github.com/apps/${app.slug}/installations/new`,
      candidates: [...candidates.values()].sort((a, b) => `${a.owner}/${a.name}`.localeCompare(`${b.owner}/${b.name}`)) };
  }

  async function verifyCurrentUserAccess(userToken: string, installationIdInput: number, repositoryIdInput: number): Promise<GitHubRepositoryAccess | null> {
    const installationId = parseInput(numericId, installationIdInput);
    const repositoryId = parseInput(numericId, repositoryIdInput);
    try {
      const installations = await transport.userPages(userToken, "/user/installations?per_page=100", { key: "installations" });
      const listed = uniqueId(installations, installationId);
      if (!listed) return null;
      const installed = parseResponse(installation, listed);
      if (installed.suspended_at !== null || installed.app_id !== transport.appId) return null;
      const repositories = await transport.userPages(userToken, `/user/installations/${installationId}/repositories?per_page=100`, { key: "repositories" });
      const listedRepository = uniqueId(repositories, repositoryId);
      if (!listedRepository) return null;
      const candidate = parseResponse(repository, listedRepository);
      if (candidate.owner.id !== installed.account.id || candidate.owner.login.toLowerCase() !== installed.account.login.toLowerCase()
        || !candidate.private || candidate.disabled) return null;

      const identity: GitHubRepositoryIdentity = {
        id: candidate.id, nodeId: candidate.node_id, installationId, ownerId: candidate.owner.id,
        owner: candidate.owner.login, name: candidate.name, defaultBranch: candidate.default_branch,
      };
      const base = repositoryPath(identity.owner, identity.name);
      const actor = parseResponse(account, await transport.userRequest(userToken, "/user"));
      const current = parseResponse(userRepository, await transport.userRequest(userToken, base));
      if (!hasIdentity(current, identity) || !current.permissions.pull) return null;
      const grant = parseResponse(permission, await transport.userRequest(userToken, `${base}/collaborators/${actor.login}/permission`));
      const role = standardRole.safeParse(grant.role_name);
      if (!role.success || grant.user.id !== actor.id || grant.user.login.toLowerCase() !== actor.login.toLowerCase()) return null;
      const adminRole = role.data === "admin";
      const writeRole = adminRole || role.data === "maintain" || role.data === "write";
      if (grant.permission !== (adminRole ? "admin" : writeRole ? "write" : "read") || (!current.archived
        && ((adminRole && !current.permissions.admin) || (writeRole && !current.permissions.push)))) return null;
      return { identity, userId: actor.id, role: role.data, canRead: true,
        canWrite: writeRole && !current.archived, canConfigure: adminRole && !current.archived };
    } catch (error) {
      if (error instanceof GitHubTransportError && ["unauthenticated", "forbidden", "not_found"].includes(error.code)) return null;
      throw error;
    }
  }

  async function verifyInstallationRepository(identity: GitHubRepositoryIdentity, signal?: AbortSignal) {
    const base = repositoryPath(identity.owner, identity.name);
    const current = parseResponse(repository, await transport.installationRequest(scope(identity, { metadata: "read" }), base, { signal }));
    if (!hasIdentity(current, identity)) throw new GitHubRepositoryError("conflict", "The GitHub repository association changed.");
    return { base, archived: current.archived };
  }

  async function readDefaultRef(identity: GitHubRepositoryIdentity, base: string, branch: string, signal?: AbortSignal): Promise<string> {
    const path = branch.split("/").map(encodeURIComponent).join("/");
    const result = parseResponse(revisionReference,
      await transport.installationRequest(scope(identity, { contents: "read" }), `${base}/git/ref/heads/${path}`, { signal }));
    if (result.ref !== `refs/heads/${branch}`) throw new GitHubRepositoryError("invalid_response", "GitHub returned a different default branch.");
    return result.object.sha;
  }

  async function readDefaultRevision(identity: GitHubRepositoryIdentity): Promise<string> {
    const branch = parseInput(gitBranch, identity.defaultBranch);
    const { base } = await verifyInstallationRepository(identity);
    return readDefaultRef(identity, base, branch);
  }

  async function readVerifiedTree(
    identity: GitHubRepositoryIdentity, base: string, revision: string, signal: AbortSignal, reads: Map<string, Promise<string>>,
  ) {
    const contents = scope(identity, { contents: "read" });
    const selected = parseResponse(commit, await transport.installationRequest(contents, `${base}/git/commits/${revision}`, { signal }));
    if (selected.sha !== revision) throw new GitHubRepositoryError("invalid_response", "GitHub returned a different Git commit.");
    const tree = parseResponse(repositoryTree,
      await transport.installationRequest(contents, `${base}/git/trees/${selected.tree.sha}?recursive=1`, { signal }));
    if (tree.sha !== selected.tree.sha) throw new GitHubRepositoryError("invalid_response", "GitHub returned a different Git tree.");
    if (tree.truncated) throw new GitHubRepositoryError("limit", "GitHub truncated the immutable tree.");
    const tracked = listTracked(tree.tree);
    const managed = tracked.filter(({ path }) => isManaged(path));
    if (managed.length > maxManagedFiles) throw new GitHubRepositoryError("limit", "The immutable tree has too many managed files.");
    let total = 0;
    for (const entry of managed) {
      if (entry.size === undefined) throw new GitHubRepositoryError("invalid_response", "A managed Git blob has no verified size.");
      total += entry.size;
      if (entry.size > maxBlobBytes || total > maxTreeBytes) {
        throw new GitHubRepositoryError("limit", "Managed Git files exceed the immutable read limits.");
      }
    }

    function readFile({ sha, size, path }: TrackedTreeEntry) {
      const expectedSize = size!;
      let existing = reads.get(sha);
      if (!existing) {
        existing = transport.installationRequest(contents, `${base}/git/blobs/${sha}`, { signal })
          .then((value) => decodeBlob(value, sha, expectedSize));
        reads.set(sha, existing);
      }
      return existing.then((body) => {
        if (Buffer.byteLength(body, "utf8") !== expectedSize) throw new GitHubRepositoryError("invalid_response", "A Git blob has conflicting sizes.");
        return { path, body };
      });
    }
    const files: { path: string; body: string }[] = [];
    for (let start = 0; start < managed.length; start += 8) files.push(...await Promise.all(managed.slice(start, start + 8).map(readFile)));
    return { treeSha: tree.sha, tracked, files };
  }

  async function readImmutableTree(identity: GitHubRepositoryIdentity, revisionInput: string): Promise<GitHubImmutableTree> {
    const revision = parseInput(objectId, revisionInput);
    const signal = AbortSignal.timeout(120_000);
    const { base } = await verifyInstallationRepository(identity, signal);
    const { treeSha, tracked, files } = await readVerifiedTree(identity, base, revision, signal, new Map());
    return { treeSha, paths: tracked.map(({ path }) => path), files };
  }

  async function observePull(identity: GitHubRepositoryIdentity, base: string, pullNumber: number, signal?: AbortSignal) {
    const observed = parseResponse(pullEndpoint, await transport.installationRequest(
      scope(identity, { pull_requests: "read" }), `${base}/pulls/${pullNumber}`, { signal },
    ));
    if (observed.number !== pullNumber || observed.state !== "open" || observed.base.ref !== identity.defaultBranch
      || observed.base.repo.id !== identity.id || observed.head.repo?.id !== identity.id) {
      throw new GitHubRepositoryError("unsupported", "Validation requires an open same-repository pull request targeting the current default branch.");
    }
    if (observed.head.ref && /^(?:refs\/heads\/)?gh-readonly-queue(?:\/|$)/u.test(observed.head.ref)) {
      throw new GitHubRepositoryError("unsupported", "Merge queue heads require a different validation flow.");
    }
    return observed;
  }

  async function observePullRequestHead(identity: GitHubRepositoryIdentity, pullNumberInput: number, publishing = false): Promise<string> {
    const pullNumber = parseInput(numericId, pullNumberInput);
    const { base, archived } = await verifyInstallationRepository(identity);
    if (publishing && archived) throw new GitHubRepositoryError("unsupported", "Checks cannot be published to an archived repository.");
    return (await observePull(identity, base, pullNumber)).head.sha;
  }

  async function observeExactPull(
    identity: GitHubRepositoryIdentity, base: string, input: GitHubPullTarget, signal?: AbortSignal,
  ) {
    const observed = await observePull(identity, base, input.pullNumber, signal);
    if (!observed.base.sha || !observed.head.ref) {
      throw new GitHubRepositoryError("invalid_response", "GitHub did not report both exact pull request targets.");
    }
    if (observed.head.sha !== input.expectedHead) throw new GitHubRepositoryError("conflict", "The pull request head changed.");
    if ((input.expectedBase !== undefined && observed.base.sha !== input.expectedBase) ||
      observed.base.sha !== await readDefaultRef(identity, base, observed.base.ref, signal)) {
      throw new GitHubRepositoryError("conflict", "The pull request base no longer matches the current default branch revision.");
    }
    return { baseRevision: observed.base.sha, headRevision: observed.head.sha, headBranch: observed.head.ref };
  }

  async function readPullRequestComparison(identity: GitHubRepositoryIdentity, input: GitHubPullTarget): Promise<GitHubPullComparison> {
    const pullNumber = parseInput(numericId, input.pullNumber);
    const expectedHead = parseInput(objectId, input.expectedHead);
    const expectedBase = input.expectedBase === undefined ? undefined : parseInput(objectId, input.expectedBase);
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
    try {
      const { base } = await verifyInstallationRepository(identity, signal);
      const { baseRevision, headRevision, headBranch } = await observeExactPull(identity, base, { pullNumber, expectedHead, expectedBase }, signal);
      const reads = new Map<string, Promise<string>>();
      const [original, candidate] = await Promise.all([
        readVerifiedTree(identity, base, baseRevision, signal, reads),
        readVerifiedTree(identity, base, headRevision, signal, reads),
      ]);
      await verifyInstallationRepository(identity, signal);
      const later = await observeExactPull(identity, base, { pullNumber, expectedHead: headRevision, expectedBase: baseRevision }, signal);
      if (later.headBranch !== headBranch) throw new GitHubRepositoryError("conflict", "The pull request head branch changed.");
      return { baseRevision, headRevision,
        baseFiles: comparisonFiles(original.tracked, original.files),
        headFiles: comparisonFiles(candidate.tracked, candidate.files),
        changedPaths: compareTrackedPaths(original.tracked, candidate.tracked) };
    } finally {
      controller.abort();
    }
  }

  function isOwnCheck(run: z.infer<typeof checkRun>, head: string) {
    return run.name === githubValidationCheckName && run.head_sha === head && run.app?.id === transport.appId;
  }

  function validationStatus(run: z.infer<typeof checkRun>): GitHubValidationStatus {
    return { id: run.id, head: run.head_sha, status: run.status, conclusion: run.conclusion };
  }

  async function publishPullRequestCheck(identity: GitHubRepositoryIdentity, input: GitHubCheckInput): Promise<GitHubValidationStatus> {
    const head = parseInput(objectId, input.expectedHead);
    const expectedBase = input.expectedBase === undefined ? undefined : parseInput(objectId, input.expectedBase);
    const conclusion = parseInput(z.enum(["success", "failure"]), input.conclusion);
    const summary = parseInput(z.string().min(1).max(4_000), input.summary);
    const pullNumber = parseInput(numericId, input.pullNumber);
    const { base, archived } = await verifyInstallationRepository(identity);
    if (archived) throw new GitHubRepositoryError("unsupported", "Checks cannot be published to an archived repository.");
    if (expectedBase !== undefined) {
      // Check creation binds the head SHA. GitHub has no atomic expected-base condition for this write.
      await observeExactPull(identity, base, { pullNumber, expectedHead: head, expectedBase });
    } else if ((await observePull(identity, base, pullNumber)).head.sha !== head) {
      throw new GitHubRepositoryError("conflict", "The pull request head changed before validation could be published.");
    }
    const run = parseResponse(checkRun, await transport.installationRequest(scope(identity, { checks: "write" }), `${base}/check-runs`, {
      method: "POST", body: { name: githubValidationCheckName, head_sha: head, status: "completed", conclusion,
        output: { title: githubValidationCheckName, summary } },
    }));
    if (!isOwnCheck(run, head) || run.status !== "completed" || run.conclusion !== conclusion) {
      throw new GitHubRepositoryError("invalid_response", "GitHub returned an unverified Check run.");
    }
    return validationStatus(run);
  }

  async function readValidationStatus(identity: GitHubRepositoryIdentity, revision: string): Promise<GitHubValidationStatus | null> {
    const head = parseInput(objectId, revision);
    const { base } = await verifyInstallationRepository(identity);
    const query = new URLSearchParams({ check_name: githubValidationCheckName, app_id: String(transport.appId), filter: "latest", per_page: "100" });
    const rows = await transport.installationPages(scope(identity, { checks: "read" }), `${base}/commits/${head}/check-runs?${query}`, { key: "check_runs" });
    const runs = rows.map((row) => parseResponse(checkRun, row)).filter((run) => isOwnCheck(run, head)).sort((a, b) => b.id - a.id);
    return runs[0] ? validationStatus(runs[0]) : null;
  }

  async function readBranchCheckEnforcement(identity: GitHubRepositoryIdentity): Promise<GitHubBranchCheckEnforcement> {
    const branch = parseInput(gitBranch, identity.defaultBranch);
    const { base } = await verifyInstallationRepository(identity);
    const rows = await transport.installationPages(scope(identity, { metadata: "read" }),
      `${base}/rules/branches/${encodeURIComponent(branch)}?per_page=100`);
    const required = rows.map((row) => parseResponse(rule, row)).some((row) => row.type === "required_status_checks"
      && parseResponse(requiredChecks, row.parameters).required_status_checks.some(({ context, integration_id }) =>
        context === githubValidationCheckName && integration_id === transport.appId));
    // This endpoint exposes active rulesets, not legacy branch protection or bypass authority.
    return { rule: required ? "required" : "unknown", bypass: "unknown" };
  }

  return { discoverConnections, verifyCurrentUserAccess, readDefaultRevision, readImmutableTree, observePullRequestHead, readPullRequestComparison, publishPullRequestCheck,
    readValidationStatus, readBranchCheckEnforcement };
}

export type GitHubAppRepository = ReturnType<typeof createGitHubAppRepository>;
