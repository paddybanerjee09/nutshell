import { buildRepositorySetupTree } from "@nutshell/core/fixture-setup-tree";
import { projectRepositoryTree } from "@nutshell/core/snapshot";
import { z } from "zod";
import { createGitHubAppRepository, type GitHubRepositoryAccess, type GitHubRepositoryIdentity } from "./github-app-repository.ts";
import type { GitHubAppTransport } from "./github-app-transport.ts";

const setupPrefix = "nutshell/setup-";
const setupTimeout = 45_000;
const revisionSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const nodeId = z.string().min(1).max(256);
const refSchema = z.object({
  id: nodeId, name: z.string(), prefix: z.literal("refs/heads/"),
  target: z.object({ oid: revisionSchema }),
});
const restPullSchema = z.object({
  number: z.int().positive(), html_url: z.string(), state: z.literal("open"),
  base: z.object({ ref: z.string(), repo: z.object({ id: z.int().positive() }) }),
  head: z.object({ ref: z.string(), sha: revisionSchema, repo: z.object({ id: z.int().positive() }) }),
});
const createdPullSchema = z.object({
  createPullRequest: z.object({ pullRequest: z.object({
    number: z.int().positive(), url: z.string(), state: z.literal("OPEN"),
    baseRefName: z.string(), baseRepository: z.object({ id: nodeId }),
    headRefName: z.string(), headRefOid: revisionSchema, headRepository: z.object({ id: nodeId }),
  }) }),
});
const preparedCommitSchema = z.object({
  sha: revisionSchema, parents: z.tuple([z.object({ sha: revisionSchema })]),
  commit: z.object({ message: z.string() }),
  files: z.array(z.object({ filename: z.string(), status: z.enum(["added", "modified"]) })).max(100),
});

const readRefDocument = `query SetupNamedRef($repositoryId: ID!, $qualifiedName: String!) {
  node(id: $repositoryId) {
    ... on Repository { id ref(qualifiedName: $qualifiedName) { id name prefix target { oid } } }
  }
}`;
const createRefDocument = `mutation CreateSetupRef($input: CreateRefInput!) {
  createRef(input: $input) { ref { id name prefix target { oid } } }
}`;
const commitDocument = `mutation CommitSetupFiles($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid } }
}`;
const createPullDocument = `mutation OpenSetupPull($input: CreatePullRequestInput!) {
  createPullRequest(input: $input) {
    pullRequest { number url state baseRefName baseRepository { id } headRefName headRefOid headRepository { id } }
  }
}`;

type Branch = z.infer<typeof refSchema>;
type SetupPull = {
  status: "awaiting_merge"; number: number; url: string; branch: string; head: string; sourceRevision: string;
};
export type GitHubSetupResult = SetupPull | { status: "configured" | "stale"; sourceRevision: string }
  | { status: "unavailable" | "forbidden" | "conflict" };
export type GitHubSetupReadResult = GitHubSetupResult | { status: "ready"; canConfigure: boolean; sourceRevision: string };
export type GitHubSetupExpectation = { userId: number; ownerId: number; nodeId: string; sourceRevision?: string };
type RepositoryAccess = Pick<ReturnType<typeof createGitHubAppRepository>,
  "verifyCurrentUserAccess" | "readDefaultRevision" | "readImmutableTree">;
type TextTree = Awaited<ReturnType<RepositoryAccess["readImmutableTree"]>>;

function parseProvider<T>(schema: z.ZodType<T>, response: unknown): T {
  const parsed = schema.safeParse(response);
  if (!parsed.success) throw new Error("GitHub returned an invalid setup response.");
  return parsed.data;
}

function restRepository(identity: GitHubRepositoryIdentity) {
  return "/repos/" + encodeURIComponent(identity.owner) + "/" + encodeURIComponent(identity.name);
}

function setupMarker(identity: GitHubRepositoryIdentity) {
  return "Nutshell setup: " + identity.id;
}

function directedPullUrl(identity: GitHubRepositoryIdentity, number: number, url: string) {
  const parsed = new URL(url);
  const expected = "/" + identity.owner + "/" + identity.name + "/pull/" + number;
  if (parsed.origin !== "https://github.com" || parsed.username || parsed.password || parsed.search || parsed.hash ||
      parsed.pathname.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("GitHub returned an unexpected setup pull request URL.");
  }
  return url;
}

function materialize(tree: TextTree) {
  // The inventory protects unmodified paths without fetching unmanaged blobs.
  const files = new Map(tree.paths.map((path) => [path, ""]));
  for (const { path, body } of tree.files) files.set(path, body);
  return files;
}

function setupChanges(identity: GitHubRepositoryIdentity, original: ReadonlyMap<string, string>) {
  const candidate = buildRepositorySetupTree([...original].map(([path, body]) => ({ path, body })), {
    name: identity.name, description: "Source-linked knowledge for " + identity.name + ".", entityId: "repo_" + identity.id,
  }, "github");
  return candidate.filter(({ path, body }) => original.get(path) !== body);
}

function matchesScope(access: GitHubRepositoryAccess | null, installationId: number, repositoryId: number,
  expected?: GitHubSetupExpectation): access is GitHubRepositoryAccess {
  return Boolean(access && access.canRead && access.identity.id === repositoryId && access.identity.installationId === installationId &&
    (!expected || (access.userId === expected.userId && access.identity.ownerId === expected.ownerId && access.identity.nodeId === expected.nodeId)));
}

export function createGitHubSetupAdapter(transport: GitHubAppTransport, repositories: RepositoryAccess = createGitHubAppRepository(transport)) {
  async function existingSetup(userToken: string, identity: GitHubRepositoryIdentity, signal: AbortSignal): Promise<SetupPull | null> {
    const query = new URLSearchParams({ state: "open", base: identity.defaultBranch });
    const rows = await transport.userPages(userToken, restRepository(identity) + "/pulls?" + query, {
      repositoryId: identity.id, maxPages: 5, maxItems: 500, signal,
    });
    const marker = setupMarker(identity);
    const marked = rows.filter((row) => {
      const parsed = z.object({ body: z.string().nullable() }).safeParse(row);
      return parsed.success && parsed.data.body?.split(/\r?\n/u).includes(marker);
    });
    if (!marked.length) return null;
    if (marked.length !== 1) throw new Error("GitHub returned more than one open Nutshell setup pull request.");
    const pr = parseProvider(restPullSchema, marked[0]);
    const sourceRevision = revisionSchema.safeParse(pr.head.ref.slice(setupPrefix.length));
    if (!pr.head.ref.startsWith(setupPrefix) || !sourceRevision.success || pr.base.ref !== identity.defaultBranch ||
        pr.head.repo.id !== identity.id || pr.base.repo.id !== identity.id || pr.head.ref === pr.base.ref) {
      throw new Error("GitHub returned a setup pull request for an unexpected repository or branch.");
    }
    return {
      status: "awaiting_merge", number: pr.number, url: directedPullUrl(identity, pr.number, pr.html_url),
      branch: pr.head.ref, head: pr.head.sha, sourceRevision: sourceRevision.data,
    };
  }

  async function readBranch(userToken: string, identity: GitHubRepositoryIdentity, name: string, signal: AbortSignal): Promise<Branch | null> {
    const response = parseProvider(z.object({ node: z.object({ id: nodeId, ref: refSchema.nullable() }) }),
      await transport.userGraphql(userToken, readRefDocument, { repositoryId: identity.nodeId, qualifiedName: "refs/heads/" + name }, signal));
    if (response.node.id !== identity.nodeId || (response.node.ref && response.node.ref.name !== name)) {
      throw new Error("GitHub returned an unexpected setup branch.");
    }
    return response.node.ref;
  }

  async function isPreparedBranch(userToken: string, identity: GitHubRepositoryIdentity, head: string, base: string,
    original: ReadonlyMap<string, string>, changes: readonly { path: string; body: string }[], signal: AbortSignal) {
    const raw = await transport.userRequest(userToken, restRepository(identity) + "/commits/" + head + "?per_page=100", { signal });
    const prepared = preparedCommitSchema.safeParse(raw);
    if (!prepared.success || prepared.data.sha !== head || prepared.data.parents[0].sha !== base ||
        !prepared.data.commit.message.split(/\r?\n/u).includes(setupMarker(identity))) return false;
    const filenames = new Map(prepared.data.files.map(({ filename, status }) => [filename, status]));
    if (prepared.data.files.length !== changes.length || filenames.size !== changes.length ||
        !changes.every(({ path }) => filenames.get(path) === (original.has(path) ? "modified" : "added"))) return false;
    const ready = materialize(await repositories.readImmutableTree(identity, head, signal));
    return changes.every(({ path, body }) => ready.get(path) === body);
  }

  async function checkedSetup(userToken: string, identity: GitHubRepositoryIdentity, signal: AbortSignal): Promise<SetupPull | { status: "conflict" } | null> {
    const proposal = await existingSetup(userToken, identity, signal);
    if (!proposal) return null;
    const original = materialize(await repositories.readImmutableTree(identity, proposal.sourceRevision, signal));
    if (original.has(".nutshell/config.json")) return { status: "conflict" };
    const changes = setupChanges(identity, original);
    return changes.length && await isPreparedBranch(userToken, identity, proposal.head, proposal.sourceRevision, original, changes, signal)
      ? proposal : { status: "conflict" };
  }

  async function readSetup(userToken: string, installationId: number, repositoryId: number,
    expected: GitHubSetupExpectation): Promise<GitHubSetupReadResult> {
    const signal = AbortSignal.timeout(setupTimeout);
    const access = await repositories.verifyCurrentUserAccess(userToken, installationId, repositoryId, signal);
    if (!matchesScope(access, installationId, repositoryId, expected)) return { status: "unavailable" };
    const { identity } = access;
    const existing = await checkedSetup(userToken, identity, signal);
    if (existing) return existing;
    const sourceRevision = await repositories.readDefaultRevision(identity, signal);
    const original = materialize(await repositories.readImmutableTree(identity, sourceRevision, signal));
    if (projectRepositoryTree(original).ok) return { status: "configured", sourceRevision };
    if (original.has(".nutshell/config.json")) return { status: "conflict" };
    return { status: "ready", sourceRevision, canConfigure: access.canConfigure && access.canWrite };
  }

  async function openSetup(userToken: string, installationId: number, repositoryId: number,
    expected?: GitHubSetupExpectation): Promise<GitHubSetupResult> {
    const signal = AbortSignal.timeout(setupTimeout);
    const access = await repositories.verifyCurrentUserAccess(userToken, installationId, repositoryId, signal);
    if (!matchesScope(access, installationId, repositoryId, expected)) return { status: "unavailable" };
    if (!access.canConfigure || !access.canWrite) return { status: "forbidden" };
    const { identity } = access;
    const existing = await checkedSetup(userToken, identity, signal);
    if (existing) return existing;

    const sourceRevision = await repositories.readDefaultRevision(identity, signal);
    if (expected?.sourceRevision && expected.sourceRevision !== sourceRevision) return { status: "stale", sourceRevision };
    const original = materialize(await repositories.readImmutableTree(identity, sourceRevision, signal));
    if (projectRepositoryTree(original).ok) return { status: "configured", sourceRevision };
    if (original.has(".nutshell/config.json")) return { status: "conflict" };
    const changes = setupChanges(identity, original);
    const branch = setupPrefix + sourceRevision;
    if (branch === identity.defaultBranch || changes.length > 100) return { status: "conflict" };
    const current = await repositories.readDefaultRevision(identity, signal);
    if (current !== sourceRevision) return { status: "stale", sourceRevision: current };

    let ref = await readBranch(userToken, identity, branch, signal);
    if (!ref) {
      const result = parseProvider(z.object({ createRef: z.object({ ref: refSchema }) }),
        await transport.userGraphql(userToken, createRefDocument, {
          input: { repositoryId: identity.nodeId, name: "refs/heads/" + branch, oid: sourceRevision },
        }, signal));
      ref = result.createRef.ref;
      if (ref.name !== branch || ref.target.oid !== sourceRevision) throw new Error("GitHub created an unexpected setup branch.");
    }

    const marker = setupMarker(identity);
    let head = ref.target.oid;
    if (head === sourceRevision) {
      const beforeCommit = await repositories.readDefaultRevision(identity, signal);
      if (beforeCommit !== sourceRevision) return { status: "stale", sourceRevision: beforeCommit };
      const result = parseProvider(z.object({ createCommitOnBranch: z.object({ commit: z.object({ oid: revisionSchema }) }) }),
        await transport.userGraphql(userToken, commitDocument, {
          input: {
            branch: { id: ref.id }, expectedHeadOid: sourceRevision,
            message: { headline: "Initialize Nutshell repository knowledge", body: marker },
            fileChanges: { additions: changes.map(({ path, body }) => ({ path, contents: Buffer.from(body, "utf8").toString("base64") })) },
          },
        }, signal));
      head = result.createCommitOnBranch.commit.oid;
    } else if (!await isPreparedBranch(userToken, identity, head, sourceRevision, original, changes, signal)) {
      return { status: "conflict" };
    }

    const latest = await repositories.readDefaultRevision(identity, signal);
    if (latest !== sourceRevision) return { status: "stale", sourceRevision: latest };
    const currentRef = await readBranch(userToken, identity, branch, signal);
    if (!currentRef || currentRef.id !== ref.id || currentRef.target.oid !== head || head === sourceRevision) return { status: "conflict" };
    const opened = await checkedSetup(userToken, identity, signal);
    if (opened) return opened;
    const result = parseProvider(createdPullSchema, await transport.userGraphql(userToken, createPullDocument, {
      input: {
        repositoryId: identity.nodeId, baseRefName: identity.defaultBranch, headRefName: branch,
        title: "Initialize Nutshell repository knowledge",
        body: marker + "\n\nReview the generated vault and product records. Nutshell will index the validated default-branch revision after merge.",
      },
    }, signal));
    const pr = result.createPullRequest.pullRequest;
    if (pr.baseRepository.id !== identity.nodeId || pr.headRepository.id !== identity.nodeId ||
        pr.baseRefName !== identity.defaultBranch || pr.headRefName !== branch || pr.headRefOid !== head) {
      throw new Error("GitHub created an unexpected setup pull request.");
    }
    return { status: "awaiting_merge", number: pr.number, url: directedPullUrl(identity, pr.number, pr.url), branch, head, sourceRevision };
  }

  return { readSetup, openSetup };
}
