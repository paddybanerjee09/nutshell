import { buildRepositorySetupTree } from "@nutshell/core/fixture-setup-tree";
import { describe, expect, it, vi } from "vitest";
import type { createGitHubAppRepository, GitHubRepositoryIdentity } from "./github-app-repository.ts";
import { createGitHubSetupAdapter } from "./github-app-setup.ts";
import type { GitHubAppTransport } from "./github-app-transport.ts";

const base = "a".repeat(40);
const written = "b".repeat(40);
const moved = "c".repeat(40);
const branchName = "nutshell/setup-" + base;
const userToken = "controlled-user-credential";
const identity = {
  id: 46, nodeId: "R_repository_46", ownerId: 892, owner: "team", name: "project",
  installationId: 39, defaultBranch: "main",
} satisfies GitHubRepositoryIdentity;
const owner = "# Owner rules\r\n\r\nKeep this owner's instructions.\r\n";
const baseFiles = [
  { path: "AGENTS.md", body: owner },
  { path: "README.md", body: "# Owner overview\n" },
];
const paths = [".github/workflows/owner.yml", "src/index.ts", ...baseFiles.map(({ path }) => path)];
const link = "https://github.com/team/project/pull/12";
const marker = "Nutshell setup: 46";
const author = { identity, userId: 892, role: "admin", canRead: true, canWrite: true, canConfigure: true } as const;
const expected = { userId: author.userId, ownerId: identity.ownerId, nodeId: identity.nodeId };
type Repositories = ReturnType<typeof createGitHubAppRepository>;

function scenario() {
  const unauthorized = () => { throw new Error("Unexpected GitHub authorization or mutation."); };
  const transport = {
    appId: 101,
    appRequest: vi.fn(unauthorized),
    installationRequest: vi.fn(unauthorized),
    installationPages: vi.fn(unauthorized),
    userPages: vi.fn<GitHubAppTransport["userPages"]>().mockResolvedValue([]),
    userRequest: vi.fn<GitHubAppTransport["userRequest"]>(unauthorized),
    userGraphql: vi.fn<GitHubAppTransport["userGraphql"]>(unauthorized),
  } satisfies GitHubAppTransport;
  const repositories = {
    verifyCurrentUserAccess: vi.fn<Repositories["verifyCurrentUserAccess"]>().mockResolvedValue(author),
    readDefaultRevision: vi.fn<Repositories["readDefaultRevision"]>().mockResolvedValue(base),
    readImmutableTree: vi.fn<Repositories["readImmutableTree"]>().mockResolvedValue({ treeSha: "d".repeat(40), paths, files: baseFiles }),
  };
  return { transport, repositories, adapter: createGitHubSetupAdapter(transport, repositories) };
}

function reference(oid: string) {
  return { id: "REF_visible_setup", name: branchName, prefix: "refs/heads/", target: { oid } };
}

function openPull() {
  return {
    number: 12, state: "open", html_url: link, body: marker + "\n\nGenerated setup proposal",
    base: { ref: identity.defaultBranch, repo: { id: identity.id } },
    head: { ref: branchName, sha: written, repo: { id: identity.id } },
  };
}

function createdPull() {
  return { createPullRequest: { pullRequest: {
    number: 12, url: link, state: "OPEN", baseRefName: identity.defaultBranch,
    baseRepository: { id: identity.nodeId }, headRefName: branchName,
    headRefOid: written, headRepository: { id: identity.nodeId },
  } } };
}

function preparedSetup() {
  const originals = new Map(paths.map((path) => [path, baseFiles.find((file) => file.path === path)?.body ?? ""]));
  const generated = buildRepositorySetupTree([...originals].map(([path, body]) => ({ path, body })), {
    name: identity.name, description: "Source-linked knowledge for project.", entityId: "repo_46",
  }, "github");
  const changed = generated.filter(({ path, body }) => originals.get(path) !== body);
  const commit = { sha: written, parents: [{ sha: base }], commit: { message: "Nutshell setup\n\n" + marker },
    files: changed.map(({ path }) => ({ filename: path, status: originals.has(path) ? "modified" : "added" })) };
  return { generated, commit };
}

describe("GitHub App repository setup", () => {
  it("uses a stable repository and branch ID, atomically appends owner guidance, and reuses the exact open proposal", async () => {
    const { adapter, transport, repositories } = scenario();
    transport.userGraphql
      .mockResolvedValueOnce({ node: { id: identity.nodeId, ref: null } })
      .mockResolvedValueOnce({ createRef: { ref: reference(base) } })
      .mockResolvedValueOnce({ createCommitOnBranch: { commit: { oid: written } } })
      .mockResolvedValueOnce({ node: { id: identity.nodeId, ref: reference(written) } })
      .mockResolvedValueOnce(createdPull());

    const first = await adapter.openSetup(userToken, identity.installationId, identity.id);
    expect(first).toEqual({ status: "awaiting_merge", number: 12, url: link, branch: branchName, head: written, sourceRevision: base });
    expect(repositories.verifyCurrentUserAccess).toHaveBeenCalledWith(userToken, identity.installationId, identity.id, expect.any(AbortSignal));
    expect(repositories.readImmutableTree).toHaveBeenCalledExactlyOnceWith(identity, base, expect.any(AbortSignal));
    expect(transport.userGraphql.mock.calls.every(([token]) => token === userToken)).toBe(true);
    const [readRef, createRef, commit, confirmRef, pull] = transport.userGraphql.mock.calls;
    expect(readRef?.[2]).toEqual({ repositoryId: identity.nodeId, qualifiedName: "refs/heads/" + branchName });
    expect(createRef?.[2]).toEqual({ input: { repositoryId: identity.nodeId, name: "refs/heads/" + branchName, oid: base } });
    expect(confirmRef?.[2]).toEqual(readRef?.[2]);
    const input = commit?.[2]?.input as {
      branch: { id: string }; expectedHeadOid: string; fileChanges: { additions: { path: string; contents: string }[] };
    };
    expect(input.branch).toEqual({ id: "REF_visible_setup" });
    expect(input.expectedHeadOid).toBe(base);
    expect(Object.keys(input.fileChanges)).toEqual(["additions"]);
    const additions = new Map(input.fileChanges.additions.map(({ path, contents }) => [path, Buffer.from(contents, "base64").toString("utf8")]));
    expect(additions.get("AGENTS.md")).toMatch(/^# Owner rules\r\n\r\nKeep this owner's instructions\.\r\n/u);
    expect(additions.get("AGENTS.md")).toContain("<!-- nutshell:managed:start -->");
    expect(additions.has("README.md")).toBe(false);
    expect(additions.has(".github/workflows/owner.yml")).toBe(false);
    expect([...additions.values()].join("\n")).not.toMatch(/synthetic fixture|simulated setup/u);
    expect(pull?.[2]).toMatchObject({ input: { repositoryId: identity.nodeId, baseRefName: "main", headRefName: branchName } });

    const { generated, commit: prepared } = preparedSetup();
    transport.userPages.mockResolvedValue([openPull()]);
    transport.userRequest.mockResolvedValue(prepared);
    repositories.readImmutableTree.mockImplementation(async (_identity, revision) => revision === base
      ? { treeSha: base, paths, files: baseFiles } : { treeSha: written, paths: generated.map(({ path }) => path), files: generated });
    await expect(adapter.openSetup(userToken, identity.installationId, identity.id, expected)).resolves.toEqual(first);
    await expect(adapter.readSetup(userToken, identity.installationId, identity.id, expected)).resolves.toEqual(first);
    expect(transport.userGraphql).toHaveBeenCalledTimes(5);
    expect(transport.installationRequest).not.toHaveBeenCalled();
  });

  it("stops at the verified configuration capability and at a changed default revision before writing", async () => {
    const denied = scenario();
    denied.repositories.verifyCurrentUserAccess.mockResolvedValue({ ...author, canConfigure: false });
    await expect(denied.adapter.openSetup(userToken, identity.installationId, identity.id)).resolves.toEqual({ status: "forbidden" });
    expect(denied.transport.userPages).not.toHaveBeenCalled();
    expect(denied.transport.userGraphql).not.toHaveBeenCalled();

    const stale = scenario();
    stale.repositories.readDefaultRevision.mockResolvedValueOnce(base).mockResolvedValueOnce(moved);
    await expect(stale.adapter.openSetup(userToken, identity.installationId, identity.id)).resolves.toEqual({
      status: "stale", sourceRevision: moved,
    });
    expect(stale.transport.userGraphql).not.toHaveBeenCalled();
  });

  it("recovers an exact prepared commit and refuses to open a changed branch", async () => {
    const { generated, commit } = preparedSetup();

    const retry = scenario();
    retry.repositories.readImmutableTree.mockResolvedValueOnce({ treeSha: base, paths, files: baseFiles })
      .mockResolvedValueOnce({ treeSha: written, paths: generated.map(({ path }) => path), files: generated });
    retry.transport.userRequest.mockResolvedValue(commit);
    retry.transport.userGraphql
      .mockResolvedValueOnce({ node: { id: identity.nodeId, ref: reference(written) } })
      .mockResolvedValueOnce({ node: { id: identity.nodeId, ref: reference(written) } })
      .mockResolvedValueOnce(createdPull());
    await expect(retry.adapter.openSetup(userToken, identity.installationId, identity.id)).resolves.toMatchObject({ status: "awaiting_merge", head: written });
    const queries = retry.transport.userGraphql.mock.calls.map(([, query]) => query);
    expect(queries.some((query) => /mutation (?:CommitSetupFiles|CreateSetupRef)/u.test(query))).toBe(false);

    const changedBranch = scenario();
    changedBranch.transport.userRequest.mockResolvedValue({ ...commit, files: [...commit.files, { filename: "src/index.ts", status: "modified" }] });
    changedBranch.transport.userGraphql.mockResolvedValueOnce({ node: { id: identity.nodeId, ref: reference(written) } });
    await expect(changedBranch.adapter.openSetup(userToken, identity.installationId, identity.id)).resolves.toEqual({ status: "conflict" });
    expect(changedBranch.transport.userGraphql).toHaveBeenCalledTimes(1);
  });

  it("observes setup as a reader and rejects changed local identity or expected source before writing", async () => {
    const reader = scenario();
    reader.repositories.verifyCurrentUserAccess.mockResolvedValue({ ...author, role: "read", canConfigure: false, canWrite: false });
    await expect(reader.adapter.readSetup(userToken, identity.installationId, identity.id, expected)).resolves.toEqual({
      status: "ready", sourceRevision: base, canConfigure: false,
    });
    expect(reader.transport.userGraphql).not.toHaveBeenCalled();

    const mismatched = scenario();
    await expect(mismatched.adapter.openSetup(userToken, identity.installationId, identity.id, { ...expected, ownerId: expected.ownerId + 1 }))
      .resolves.toEqual({ status: "unavailable" });
    expect(mismatched.transport.userPages).not.toHaveBeenCalled();
    expect(mismatched.transport.userGraphql).not.toHaveBeenCalled();

    const stale = scenario();
    await expect(stale.adapter.openSetup(userToken, identity.installationId, identity.id, { ...expected, sourceRevision: moved }))
      .resolves.toEqual({ status: "stale", sourceRevision: base });
    expect(stale.repositories.readImmutableTree).not.toHaveBeenCalled();
    expect(stale.transport.userGraphql).not.toHaveBeenCalled();
  });

  it("refuses a setup-marked open PR whose exact files no longer match", async () => {
    const { adapter, transport } = scenario();
    const { commit } = preparedSetup();
    transport.userPages.mockResolvedValue([openPull()]);
    transport.userRequest.mockResolvedValue({ ...commit, files: [...commit.files, { filename: "src/index.ts", status: "modified" }] });
    await expect(adapter.readSetup(userToken, identity.installationId, identity.id, expected)).resolves.toEqual({ status: "conflict" });
    await expect(adapter.openSetup(userToken, identity.installationId, identity.id, expected)).resolves.toEqual({ status: "conflict" });
    expect(transport.userGraphql).not.toHaveBeenCalled();
  });

  it("propagates a denied user write without calling installation authority", async () => {
    const { adapter, transport } = scenario();
    const denied = new Error("Controlled user authorization failure");
    transport.userGraphql.mockResolvedValueOnce({ node: { id: identity.nodeId, ref: reference(base) } }).mockRejectedValueOnce(denied);
    await expect(adapter.openSetup(userToken, identity.installationId, identity.id)).rejects.toBe(denied);
    expect(transport.userGraphql).toHaveBeenCalledTimes(2);
    expect(transport.appRequest).not.toHaveBeenCalled();
    expect(transport.installationRequest).not.toHaveBeenCalled();
  });
});
