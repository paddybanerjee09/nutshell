import { createHash, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGitHubAppRepository, githubValidationCheckName, type GitHubRepositoryIdentity } from "./github-app-repository.ts";
import { createGitHubAppTransport, type GitHubInstallationPermissions } from "./github-app-transport.ts";

const appId = 907;
const repositoryId = 219;
const installationId = 538;
const actor = { id: 709, login: "fixture-user" };
const account = { id: 166, login: "synthetic-owner" };
const repoName = "fake-repository";
const repoPath = `/repos/${account.login}/${repoName}`;
const userToken = "ghu_synthetic_fixture_test_token";
const revision = "a".repeat(40);
const otherRevision = "b".repeat(40);
const treeSha = "c".repeat(40);
const defaultBranch = "release/main";
const metadata = { id: repositoryId, node_id: "R_fixtureRepo", owner: account, name: repoName,
  default_branch: defaultBranch, private: true, archived: false, disabled: false };
const activeInstallation = { id: installationId, app_id: appId, account, suspended_at: null, target_type: "Organization" };
const basePermissions: Readonly<Record<string, string>> = { admin: "admin", maintain: "write", write: "write", read: "read", triage: "read" };
const identity: GitHubRepositoryIdentity = { id: repositoryId, nodeId: metadata.node_id, installationId,
  ownerId: account.id, owner: account.login, name: repoName, defaultBranch };
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

type RequestRecord = { url: URL; method: string; authorization: string | null; permissions?: GitHubInstallationPermissions; body?: unknown };

function fakeGitHub(respond: (request: RequestRecord) => Response) {
  const requests: RequestRecord[] = [];
  const minted = new Map<string, GitHubInstallationPermissions>();
  const transport = createGitHubAppTransport({ appId: String(appId), privateKey, fetch: async (input, options) => {
    const request = new Request(input, options);
    const url = new URL(request.url);
    expect(url.origin).toBe("https://api.github.com");
    const authorization = request.headers.get("authorization");
    const method = request.method;
    const body: unknown = request.body ? await request.json() : undefined;
    if (url.pathname === `/app/installations/${installationId}/access_tokens` && method === "POST") {
      expect(authorization).toMatch(/^Bearer ey/u);
      const { repository_ids, permissions } = body as { repository_ids: number[]; permissions: GitHubInstallationPermissions };
      expect(repository_ids).toEqual([repositoryId]);
      requests.push({ url, method, authorization, body });
      const token = `ghs_synthetic_installation_scope_${minted.size}`;
      minted.set(`Bearer ${token}`, permissions);
      return Response.json({ token, expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions,
        repositories: [{ id: repositoryId }] }, { status: 201 });
    }
    const permissions = authorization ? minted.get(authorization) : undefined;
    expect(authorization === `Bearer ${userToken}` || Boolean(permissions)).toBe(true);
    const record = { url, method, authorization, permissions, body };
    requests.push(record);
    return respond(record);
  } });
  return { repo: createGitHubAppRepository(transport), requests };
}

function userResponse(request: RequestRecord, options: { role?: string; permission?: string; installation?: object; grantActor?: object; forbidden?: boolean; repo?: object } = {}) {
  expect(request.authorization).toBe(`Bearer ${userToken}`);
  expect(request.permissions).toBeUndefined();
  const { pathname } = request.url;
  if (pathname === "/user/installations") return Response.json({ installations: [options.installation ?? activeInstallation] });
  if (pathname === `/user/installations/${installationId}/repositories`) {
    return options.forbidden ? Response.json({ message: "private" }, { status: 403 }) : Response.json({ repositories: [metadata] });
  }
  if (pathname === "/user") return Response.json(actor);
  const role = options.role ?? "admin";
  const base = options.permission ?? basePermissions[role] ?? "write";
  if (pathname === repoPath) return Response.json({ ...metadata,
    permissions: { pull: true, push: base !== "read", admin: base === "admin" }, ...options.repo });
  expect(pathname).toBe(`${repoPath}/collaborators/${actor.login}/permission`);
  return Response.json({ user: options.grantActor ?? actor, role_name: role, permission: base });
}

function gitBlob(input: string | Buffer, algorithm: "sha1" | "sha256" = "sha1") {
  const data = typeof input === "string" ? Buffer.from(input) : input;
  const size = data.byteLength;
  const sha = createHash(algorithm).update(`blob ${size}\0`).update(data).digest("hex");
  return { sha, size, content: data.toString("base64"), encoding: "base64" };
}

function file(path: string, data: ReturnType<typeof gitBlob>) {
  return { path, mode: "100644", type: "blob", size: data.size, sha: data.sha };
}

function gitResponses(request: RequestRecord, tree: readonly object[], blobs = new Map<string, object>(), truncated = false) {
  const { pathname } = request.url;
  if (pathname === repoPath) {
    expect(request.permissions).toEqual({ metadata: "read" });
    return Response.json(metadata);
  }
  expect(request.permissions).toEqual({ contents: "read" });
  if (pathname === `${repoPath}/git/ref/heads/release/main`) return Response.json({ ref: "refs/heads/release/main", object: { type: "commit", sha: revision } });
  if (pathname === `${repoPath}/git/commits/${revision}`) return Response.json({ sha: revision, tree: { sha: treeSha } });
  if (pathname === `${repoPath}/git/trees/${treeSha}`) {
    expect(request.url.searchParams.get("recursive")).toBe("1");
    return Response.json({ sha: treeSha, tree, truncated });
  }
  const data = blobs.get(pathname.slice(pathname.lastIndexOf("/") + 1));
  if (data) return Response.json(data);
  throw new Error("Unexpected fixture Git request " + pathname);
}

const ownCheck = { id: 79, name: githubValidationCheckName, head_sha: revision, app: { id: appId }, status: "completed", conclusion: "success" };

describe("GitHub App repository access", () => {
  it("verifies exact stable identities and provider capabilities across paginated user-token results", async () => {
    const fixture = fakeGitHub((request) => {
      if (request.url.pathname === "/user/installations" && !request.url.searchParams.has("page")) {
        const next = new URL(request.url);
        next.searchParams.set("page", "2");
        return Response.json({ installations: [{ id: installationId + 1 }] }, { headers: { Link: `<${next}>; rel="next"` } });
      }
      return userResponse(request);
    });
    expect(await fixture.repo.verifyCurrentUserAccess(userToken, installationId, repositoryId)).toEqual({
      identity, userId: actor.id, role: "admin", canRead: true, canWrite: true, canConfigure: true,
    });
    expect(fixture.requests.filter(({ url }) => url.pathname === "/user/installations")).toHaveLength(2);
    expect(fixture.requests.every(({ authorization }) => authorization === `Bearer ${userToken}`)).toBe(true);
  });

  it.each([
    ["read", false], ["triage", false], ["write", true], ["maintain", true],
  ] as const)("keeps configuration separate from the %s role", async (role, canWrite) => {
    const { repo } = fakeGitHub((request) => userResponse(request, { role }));
    expect(await repo.verifyCurrentUserAccess(userToken, installationId, repositoryId)).toMatchObject({ role, canRead: true, canWrite, canConfigure: false });
  });

  it("denies custom roles, ambiguous identities, and lost installation access with no App fallback", async () => {
    for (const options of [{ role: "custom maintainer", permission: "admin" }, { role: "admin", permission: "write" },
      { grantActor: { ...actor, id: actor.id + 1 } }, { forbidden: true }, { repo: { owner: { ...account, id: account.id + 1 } } },
      { repo: { disabled: true } },
      { installation: { ...activeInstallation, suspended_at: "2026-11-27T00:00:00Z" } },
      { installation: { ...activeInstallation, app_id: appId + 1 } }]) {
      const { repo, requests } = fakeGitHub((request) => userResponse(request, options));
      expect(await repo.verifyCurrentUserAccess(userToken, installationId, repositoryId)).toBeNull();
      expect(requests.every(({ authorization }) => authorization === `Bearer ${userToken}`)).toBe(true);
    }
  });
});

describe("GitHub App immutable repository reads", () => {
  it("resolves the exact default ref and reads only validated managed text from the pinned tree", async () => {
    const ownerText = "\uFEFF# Owner rules\r\n\r\nKeep 雪 unchanged.\r\n";
    const gitOwner = gitBlob(ownerText);
    const index = gitBlob("# Exact index\n", "sha256");
    const metadataOnly = "f".repeat(40);
    const fixtures = [file("nutshell-vault/_INDEX.md", index), file("README.md", gitOwner), file("AGENTS.md", gitOwner),
      { path: "src/large.png", type: "blob", mode: "100644", size: 50_000_000, sha: metadataOnly },
      { path: "vendor", type: "commit", mode: "160000", sha: metadataOnly }];
    const { repo, requests } = fakeGitHub((request) => gitResponses(request, fixtures, new Map([[gitOwner.sha, gitOwner], [index.sha, index]])));
    await expect(repo.readDefaultRevision({ ...identity, defaultBranch: "../invalid" })).rejects.toMatchObject({ code: "invalid_request" });
    expect(requests).toHaveLength(0);
    expect(await repo.readDefaultRevision(identity)).toBe(revision);
    expect(await repo.readImmutableTree(identity, revision)).toEqual({ treeSha,
      paths: ["AGENTS.md", "README.md", "nutshell-vault/_INDEX.md", "src/large.png", "vendor"],
      files: [{ path: "AGENTS.md", body: ownerText }, { path: "README.md", body: ownerText },
        { path: "nutshell-vault/_INDEX.md", body: "# Exact index\n" }],
    });
    expect(requests.filter(({ url }) => url.pathname.includes("/git/blobs/")).map(({ url }) => url.pathname))
      .toEqual([`${repoPath}/git/blobs/${gitOwner.sha}`, `${repoPath}/git/blobs/${index.sha}`]);
    expect(requests.filter(({ url }) => url.pathname.endsWith("/access_tokens"))).toHaveLength(2);
  });

  it("fails closed on truncated trees, oversized files, managed symlinks and conflicting tree paths before blob reads", async () => {
    const managed = file("AGENTS.md", gitBlob("# owner"));
    for (const [entries, truncated, code] of [
      [[managed], true, "limit"], [[{ ...managed, size: 256 * 1024 + 1 }], false, "limit"],
      [[{ ...managed, mode: "120000" }], false, "unsupported"],
      [[{ ...managed, path: "nutshell-vault/features", mode: "120000" }], false, "unsupported"],
      [[managed, { ...managed, path: "AGENTS.md/_INDEX.md" }], false, "invalid_response"],
      [[{ ...managed, path: "../AGENTS.md" }], false, "invalid_response"],
    ] as const) {
      const { repo, requests } = fakeGitHub((request) => gitResponses(request, entries, undefined, truncated));
      await expect(repo.readImmutableTree(identity, revision)).rejects.toMatchObject({ code });
      expect(requests.some(({ url }) => url.pathname.includes("/git/blobs/"))).toBe(false);
    }
  });

  it("rejects wrong blob bytes and invalid UTF-8 rather than adjusting the immutable source", async () => {
    const record = gitBlob("one");
    const badUtf8 = gitBlob(Buffer.from([0xC3, 0x28]));
    for (const [managed, returned, code] of [[record, { ...record, content: gitBlob("two").content }, "invalid_response"],
      [badUtf8, badUtf8, "unsupported"]] as const) {
      const { repo } = fakeGitHub((request) => gitResponses(request, [file("AGENTS.md", managed)], new Map([[managed.sha, returned]])));
      await expect(repo.readImmutableTree(identity, revision)).rejects.toMatchObject({ code });
    }
  });
});

describe("GitHub App exact pull request comparisons", () => {
  const originalTree = "d".repeat(40);
  const syntheticMerge = "e".repeat(40);
  const pull = {
    number: 37, state: "open", merge_commit_sha: syntheticMerge,
    head: { sha: revision, ref: "feature/trusted-candidate", repo: { id: repositoryId } },
    base: { sha: otherRevision, ref: defaultBranch, repo: { id: repositoryId } },
  };
  const input = { pullNumber: 37, expectedHead: revision, expectedBase: otherRevision };
  const owner = gitBlob("# Keep these owner instructions.\r\n");
  const originalConfig = gitBlob('{"coverage":{"include":["src/**"]}}\n');
  const candidateConfig = gitBlob('{"coverage":{"include":[]}}\n');
  const oldSource = gitBlob("old source");
  const newSource = gitBlob("new source");
  const baseEntries = [
    file("AGENTS.md", owner), file(".nutshell/config.json", originalConfig),
    { path: "src", mode: "040000", type: "tree", sha: originalTree }, file("src/changed.ts", oldSource),
    file("src/deleted.ts", oldSource), file("src/mode.ts", oldSource), file("src/old-name.ts", newSource),
    { path: "vendor/module", mode: "160000", type: "commit", sha: syntheticMerge },
  ];
  const headEntries = [
    file("AGENTS.md", owner), file(".nutshell/config.json", candidateConfig),
    { path: "src", mode: "040000", type: "tree", sha: treeSha }, file("src/changed.ts", newSource),
    { ...file("src/mode.ts", oldSource), mode: "100755" }, file("src/new-name.ts", newSource),
    file("vendor/module", oldSource),
  ];

  function comparisonFixture({
    pulls = [pull], refs = [otherRevision], truncated = false, candidate = headEntries,
  }: { pulls?: readonly object[]; refs?: readonly string[]; truncated?: boolean; candidate?: readonly object[] } = {}) {
    let pullReads = 0;
    let refReads = 0;
    const blobs = new Map([owner, originalConfig, candidateConfig].map((entry) => [entry.sha, entry]));
    return fakeGitHub((request) => {
      const { pathname } = request.url;
      if (pathname === repoPath) return Response.json(metadata);
      if (pathname === repoPath + "/pulls/37") return Response.json(pulls[Math.min(pullReads++, pulls.length - 1)]);
      if (pathname === repoPath + "/check-runs") {
        expect(request.permissions).toEqual({ checks: "write" });
        expect(request.body).toMatchObject({ head_sha: revision });
        return Response.json(ownCheck, { status: 201 });
      }
      expect(request.permissions).toEqual({ contents: "read" });
      if (pathname === repoPath + "/git/ref/heads/release/main") return Response.json({
        ref: "refs/heads/release/main", object: { type: "commit", sha: refs[Math.min(refReads++, refs.length - 1)] },
      });
      if (pathname === repoPath + "/git/commits/" + otherRevision) return Response.json({ sha: otherRevision, tree: { sha: originalTree } });
      if (pathname === repoPath + "/git/commits/" + revision) return Response.json({ sha: revision, tree: { sha: treeSha } });
      if (pathname === repoPath + "/git/trees/" + originalTree) return Response.json({ sha: originalTree, tree: baseEntries, truncated: false });
      if (pathname === repoPath + "/git/trees/" + treeSha) return Response.json({ sha: treeSha, tree: candidate, truncated });
      const data = blobs.get(pathname.slice(pathname.lastIndexOf("/") + 1));
      if (data && pathname.startsWith(repoPath + "/git/blobs/")) return Response.json(data);
      throw new Error("Unexpected fixture comparison request " + pathname);
    });
  }

  it("uses immutable base and head trees for changed blobs, modes, types, removals and both rename paths", async () => {
    const { repo, requests } = comparisonFixture();
    const result = await repo.readPullRequestComparison(identity, { pullNumber: 37, expectedHead: revision.toUpperCase() });
    expect(result).toEqual({
      baseRevision: otherRevision, headRevision: revision,
      baseFiles: new Map([["AGENTS.md", "# Keep these owner instructions.\r\n"], [".nutshell/config.json", '{"coverage":{"include":["src/**"]}}\n'],
        ["src/changed.ts", ""], ["src/deleted.ts", ""], ["src/mode.ts", ""], ["src/old-name.ts", ""], ["vendor/module", ""]]),
      headFiles: new Map([["AGENTS.md", "# Keep these owner instructions.\r\n"], [".nutshell/config.json", '{"coverage":{"include":[]}}\n'],
        ["src/changed.ts", ""], ["src/mode.ts", ""], ["src/new-name.ts", ""], ["vendor/module", ""]]),
      changedPaths: [".nutshell/config.json", "src/changed.ts", "src/deleted.ts", "src/mode.ts", "src/new-name.ts", "src/old-name.ts", "vendor/module"],
    });
    expect(requests.filter(({ url }) => url.pathname === repoPath + "/pulls/37")).toHaveLength(2);
    expect(requests.filter(({ url }) => url.pathname === repoPath + "/git/ref/heads/release/main")).toHaveLength(2);
    expect(requests.filter(({ url }) => url.pathname.includes("/git/blobs/"))).toHaveLength(3);
    expect(requests.some(({ url }) => url.pathname.includes("/pulls/37/files") || url.pathname.endsWith(syntheticMerge))).toBe(false);
  });

  it("rejects unsupported forks, merge queue refs and non-default bases before reading candidate files", async () => {
    for (const observed of [
      { ...pull, head: { ...pull.head, repo: { id: repositoryId + 1 } } },
      { ...pull, head: { ...pull.head, repo: null } },
      { ...pull, head: { ...pull.head, ref: "gh-readonly-queue/release/main/pr-37" } },
      { ...pull, base: { ...pull.base, ref: "feature/another-base" } },
      { ...pull, base: { ...pull.base, repo: { id: repositoryId + 1 } } },
    ]) {
      const { repo, requests } = comparisonFixture({ pulls: [observed] });
      await expect(repo.readPullRequestComparison(identity, input)).rejects.toMatchObject({ code: "unsupported" });
      expect(requests.some(({ url }) => url.pathname.includes("/git/commits/"))).toBe(false);
    }
  });

  it("fails closed on missing exact pull evidence, truncated trees, or movement during immutable reads", async () => {
    const missing = comparisonFixture({ pulls: [{ ...pull, base: { ...pull.base, sha: undefined } }] });
    await expect(missing.repo.readPullRequestComparison(identity, input)).rejects.toMatchObject({ code: "invalid_response" });
    const truncated = comparisonFixture({ truncated: true });
    await expect(truncated.repo.readPullRequestComparison(identity, input)).rejects.toMatchObject({ code: "limit" });
    for (const unsafe of [
      { ...file("nutshell-vault/linked.md", owner), mode: "120000" },
      { path: ".nutshell/config.json", mode: "160000", type: "commit", sha: syntheticMerge },
    ]) {
      const { repo } = comparisonFixture({ candidate: [unsafe] });
      await expect(repo.readPullRequestComparison(identity, input)).rejects.toMatchObject({ code: "unsupported" });
    }
    for (const fixture of [
      comparisonFixture({ pulls: [pull, { ...pull, head: { ...pull.head, sha: syntheticMerge } }] }),
      comparisonFixture({ pulls: [pull, { ...pull, head: { ...pull.head, ref: "changed-head-branch" } }] }),
      comparisonFixture({ pulls: [pull, { ...pull, base: { ...pull.base, sha: syntheticMerge } }] }),
      comparisonFixture({ refs: [otherRevision, syntheticMerge] }),
    ]) {
      await expect(fixture.repo.readPullRequestComparison(identity, input)).rejects.toMatchObject({ code: "conflict" });
      expect(fixture.requests.filter(({ url }) => url.pathname.includes("/git/commits/"))).toHaveLength(2);
    }
  });

  it("rechecks an exact observed base before acquiring write authority to publish the head Check", async () => {
    const check = { ...input, conclusion: "success", summary: "Validated an exact base and head." } as const;
    for (const fixture of [
      comparisonFixture({ pulls: [{ ...pull, base: { ...pull.base, sha: syntheticMerge } }] }),
      comparisonFixture({ refs: [syntheticMerge] }),
    ]) {
      await expect(fixture.repo.publishPullRequestCheck(identity, check)).rejects.toMatchObject({ code: "conflict" });
      expect(fixture.requests.some(({ url, body }) => url.pathname.endsWith("/check-runs")
        || (body as { permissions?: { checks?: string } })?.permissions?.checks === "write")).toBe(false);
    }
    const accepted = comparisonFixture();
    await expect(accepted.repo.publishPullRequestCheck(identity, check)).resolves.toMatchObject({ head: revision, conclusion: "success" });
    expect(accepted.requests.findIndex(({ url }) => url.pathname.includes("/git/ref/heads/")))
      .toBeLessThan(accepted.requests.findIndex(({ url }) => url.pathname.endsWith("/check-runs")));
  });
});

describe("GitHub App exact-head Checks", () => {
  const pull = { number: 37, state: "open", head: { sha: revision, repo: { id: repositoryId } },
    base: { ref: defaultBranch, repo: { id: repositoryId } } };
  const input = { pullNumber: 37, expectedHead: revision, conclusion: "success", summary: "Validated the exact candidate." } as const;

  it("keeps currently readable archived repositories read-only, including immutable source and existing Check status", async () => {
    const archive = { archived: true, permissions: { pull: true, push: false, admin: false } };
    const owner = gitBlob("# Archived owner instructions\n");
    const { repo, requests } = fakeGitHub((request) => {
      if (request.authorization === `Bearer ${userToken}`) return userResponse(request, { repo: archive });
      if (request.url.pathname === repoPath) return Response.json({ ...metadata, ...archive });
      if (request.url.pathname.endsWith(`/commits/${revision}/check-runs`)) {
        expect(request.permissions).toEqual({ checks: "read" });
        return Response.json({ check_runs: [ownCheck] });
      }
      return gitResponses(request, [file("AGENTS.md", owner)], new Map([[owner.sha, owner]]));
    });
    expect(await repo.verifyCurrentUserAccess(userToken, installationId, repositoryId)).toMatchObject({
      identity, role: "admin", canRead: true, canWrite: false, canConfigure: false,
    });
    expect(await repo.readDefaultRevision(identity)).toBe(revision);
    expect((await repo.readImmutableTree(identity, revision)).files).toEqual([{ path: "AGENTS.md", body: "# Archived owner instructions\n" }]);
    expect(await repo.readValidationStatus(identity, revision)).toMatchObject({ id: ownCheck.id, conclusion: "success" });
    await expect(repo.publishPullRequestCheck(identity, input)).rejects.toMatchObject({ code: "unsupported" });
    expect(requests.some(({ method, url }) => method === "POST" && url.pathname.endsWith("/check-runs"))).toBe(false);
  });

  it("publishes only the observed same-repository head with a scoped installation Checks grant", async () => {
    const { repo } = fakeGitHub((request) => {
      switch (request.url.pathname) {
        case repoPath: return Response.json(metadata);
        case `${repoPath}/pulls/37`:
          expect(request.permissions).toEqual({ pull_requests: "read" });
          return Response.json(pull);
        case `${repoPath}/check-runs`:
          expect(request.method).toBe("POST");
          expect(request.permissions).toEqual({ checks: "write" });
          expect(request.body).toEqual({ name: githubValidationCheckName, head_sha: revision, status: "completed", conclusion: "success",
            output: { title: githubValidationCheckName, summary: input.summary } });
          return Response.json(ownCheck, { status: 201 });
        default: throw new Error("Unexpected fixture Check request.");
      }
    });
    expect(await repo.publishPullRequestCheck(identity, input)).toEqual({ id: ownCheck.id, head: revision, status: "completed", conclusion: "success" });
  });

  it("rejects moved heads, forks, closed or other-base pulls before minting Check-write authority", async () => {
    for (const candidate of [{ ...pull, head: { ...pull.head, sha: otherRevision } },
      { ...pull, head: { ...pull.head, repo: { id: repositoryId + 1 } } },
      { ...pull, state: "closed" }, { ...pull, base: { ...pull.base, ref: "other-branch" } }]) {
      const { repo, requests } = fakeGitHub((request) => Response.json(request.url.pathname === repoPath ? metadata : candidate));
      await expect(repo.publishPullRequestCheck(identity, input)).rejects.toMatchObject({ code: expect.stringMatching(/^(?:conflict|unsupported)$/u) });
      expect(requests.some(({ url, body }) => url.pathname.endsWith("/check-runs") || (body as { permissions?: { checks?: string } })?.permissions?.checks === "write")).toBe(false);
    }
  });

  it("keeps App-sourced Check status separate from observed active branch rules and bypass", async () => {
    let enforced = false;
    const { repo } = fakeGitHub((request) => {
      if (request.url.pathname === repoPath) return Response.json(metadata);
      if (request.url.pathname.endsWith(`/commits/${revision}/check-runs`)) {
        expect(request.permissions).toEqual({ checks: "read" });
        expect(request.url.searchParams.get("app_id")).toBe(String(appId));
        return Response.json({ check_runs: [{ ...ownCheck, id: 81, app: { id: appId + 1 } }, { ...ownCheck, id: 80, head_sha: otherRevision }, ownCheck] });
      }
      expect(decodeURIComponent(request.url.pathname)).toBe(`${repoPath}/rules/branches/${defaultBranch}`);
      expect(request.permissions).toEqual({ metadata: "read" });
      return Response.json([{ type: "required_status_checks", parameters: { required_status_checks: [
        { context: githubValidationCheckName, integration_id: enforced ? appId : null },
      ] } }]);
    });
    expect(await repo.readValidationStatus(identity, revision)).toMatchObject({ id: ownCheck.id, conclusion: "success" });
    expect(await repo.readBranchCheckEnforcement(identity)).toEqual({ rule: "unknown", bypass: "unknown" });
    enforced = true;
    expect(await repo.readBranchCheckEnforcement(identity)).toEqual({ rule: "required", bypass: "unknown" });
  });
});
