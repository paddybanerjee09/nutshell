import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { validateSourceFeature } from "@nutshell/core/source-task";
import { validateVault } from "@nutshell/core/vault";
import { readGitSnapshot } from "./vault-files.ts";

const source = { id: 1467144605, name: "paddybanerjee09/nutshell", branch: "main" };
const apiOrigin = "https://api.github.com";
const repositoryApi = `${apiOrigin}/repos/${source.name}`;
const taskPath = "nutshell-vault/CURRENT_TASK.md";
const context = "nutshell/source-task";
const maxPayloadBytes = 1024 * 1024;
const maxBodyBytes = 256 * 1024;
const sha = /^[0-9a-f]{40}$/;
const actions = new Set(["opened", "reopened", "synchronize", "edited", "ready_for_review"]);

type PullRef = { branch: string; sha: string };
type Pull = {
  id: number; number: number; state: "open" | "closed"; url: string; base: PullRef; head: PullRef; body: string | null;
};
type CheckerOptions = {
  event: unknown;
  token: string;
  cwd: string;
  fetcher?: typeof fetch;
  readSnapshot?: typeof readGitSnapshot;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function sourceRepository(value: unknown): boolean {
  const repo = object(value);
  return repo?.id === source.id && repo.full_name === source.name;
}

function sourceRef(value: unknown): PullRef | undefined {
  const ref = object(value);
  if (!ref || !sourceRepository(ref.repo)) return;
  if (typeof ref.sha !== "string" || ref.sha.length !== 40 || !sha.test(ref.sha)) return;
  if (typeof ref.ref !== "string" || !ref.ref || Buffer.byteLength(ref.ref) > 256) return;
  return { branch: ref.ref, sha: ref.sha };
}

function pullRequest(value: unknown): Pull {
  const pull = object(value);
  if (!pull || !positiveInteger(pull.id) || !positiveInteger(pull.number) ||
    (pull.state !== "open" && pull.state !== "closed")) {
    throw new Error("Expected a GitHub pull request with a stable identity.");
  }

  const base = sourceRef(pull.base);
  const head = sourceRef(pull.head);
  if (base?.branch !== source.branch || !head || head.branch === base.branch) {
    throw new Error("Expected a same-repository PR targeting the source default branch.");
  }
  const url = `https://github.com/${source.name}/pull/${pull.number}`;
  if (pull.html_url !== url || (pull.body !== null &&
    (typeof pull.body !== "string" || Buffer.byteLength(pull.body) > maxBodyBytes))) {
    throw new Error("Invalid GitHub pull request URL or description size.");
  }
  return { id: pull.id, number: pull.number, state: pull.state, url, base, head, body: pull.body };
}

function eventPull(value: unknown): Pull {
  const event = object(value);
  if (!event || typeof event.action !== "string" || !actions.has(event.action) ||
    !sourceRepository(event.repository) || object(event.repository)?.default_branch !== source.branch) {
    throw new Error("Expected an eligible event for the Nutshell source repository.");
  }
  const pull = pullRequest(event.pull_request);
  if (event.number !== pull.number) throw new Error("Pull request number does not match the event.");
  if (pull.state !== "open") throw new Error("Expected an event for an open pull request.");
  return pull;
}

function obsoleteReason(event: Pull, current: Pull) {
  if (event.id !== current.id || event.number !== current.number) {
    throw new Error("GitHub returned a different pull request identity.");
  }
  if (current.state === "closed") return "closed";
  if (event.body !== current.body || event.base.sha !== current.base.sha ||
    event.head.branch !== current.head.branch || event.head.sha !== current.head.sha) return "superseded";
}

function marker(body: string | null): string | undefined {
  const lines = body?.split(/\r?\n/).filter((line) => line.startsWith("Nutshell task:"));
  if (lines?.length !== 1 || !lines[0]) return;
  const match = /^Nutshell task: ([a-z0-9][a-z0-9-]{0,127})$/.exec(lines[0]);
  return match?.[0] === lines[0] ? match[1] : undefined;
}

function decodeJson(bytes: Buffer): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Invalid JSON in a source check input.");
  }
}

function readEventFile(path: string): unknown {
  const bytes = Buffer.alloc(maxPayloadBytes + 1);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxPayloadBytes) throw new Error("Invalid Actions event payload file.");

    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) return decodeJson(bytes.subarray(0, length));
      length += count;
    }
    throw new Error("Actions event payload exceeds the size limit.");
  } finally {
    closeSync(fd);
  }
}

async function responseJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing GitHub pull request response body.");

  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return decodeJson(Buffer.concat(chunks, length));
      length += value.byteLength;
      if (length > maxPayloadBytes) throw new Error("GitHub pull request response exceeds the size limit.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

async function validateSnapshots(pull: Pull, cwd: string, readSnapshot: typeof readGitSnapshot): Promise<string[]> {
  const taskId = marker(pull.body);
  if (!taskId) return ["pr-task-marker"];

  try {
    const base = await readSnapshot(cwd, pull.base.sha, pull.base.sha);
    const proposed = await readSnapshot(cwd, pull.base.sha, pull.head.sha);
    if (base.base !== pull.base.sha || base.head !== pull.base.sha ||
      proposed.base !== pull.base.sha || proposed.head !== pull.head.sha) return ["git-snapshot-identity"];

    const baseText = base.files.get(taskPath);
    const proposedText = proposed.files.get(taskPath);
    if (baseText === undefined || proposedText === undefined) return ["missing-current-task"];

    const vaultIssues = validateVault(proposed.files);
    const featureIssues = validateSourceFeature(baseText, proposedText, {
      repositoryId: source.id,
      baseBranch: pull.base.branch,
      headBranch: pull.head.branch,
      prNumber: pull.number,
      prUrl: pull.url,
      taskId,
    });
    return [...new Set([...vaultIssues, ...featureIssues].map((issue) => issue.code))].sort();
  } catch {
    return ["git-snapshot-unavailable"];
  }
}

export async function checkSourcePullRequest({ event, token, cwd, fetcher = fetch, readSnapshot = readGitSnapshot }: CheckerOptions) {
  if (!token || token.length > 512 || /\s/.test(token)) throw new Error("Missing or invalid GitHub Actions token.");
  const payload = eventPull(event);
  const pullUrl = `${repositoryApi}/pulls/${payload.number}`;
  const identity = { number: payload.number, head: payload.head.sha };

  async function github(path: string, status?: object): Promise<Response> {
    try {
      return await fetcher(path, {
        method: status ? "POST" : "GET",
        body: status ? JSON.stringify(status) : undefined,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error("GitHub API request failed.");
    }
  }

  async function currentPull(): Promise<Pull> {
    const response = await github(pullUrl);
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`Unable to verify the current GitHub pull request (${response.status}).`);
    }
    return pullRequest(await responseJson(response));
  }

  const verified = await currentPull();
  const before = obsoleteReason(payload, verified);
  if (before) return { state: "skipped" as const, reason: before, ...identity };
  const issues = await validateSnapshots(verified, cwd, readSnapshot);
  const after = obsoleteReason(payload, await currentPull());
  if (after) return { state: "skipped" as const, reason: after, ...identity };

  const state: "success" | "failure" = issues.length === 0 ? "success" : "failure";
  const response = await github(`${repositoryApi}/statuses/${verified.head.sha}`, {
    context,
    state,
    description: state === "success" ? "Vault and source task validated" : "Vault or source task validation failed",
    target_url: verified.url,
  });
  await response.body?.cancel().catch(() => {});
  if (response.status !== 201) throw new Error(`GitHub did not create the commit status (${response.status}).`);
  return { state, issues, ...identity };
}

async function main(): Promise<number> {
  const env = process.env;
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_EVENT_NAME !== "pull_request_target" ||
    env.GITHUB_REPOSITORY !== source.name || env.GITHUB_API_URL !== apiOrigin || !env.GITHUB_EVENT_PATH) {
    throw new Error("Run the source check from the trusted Nutshell pull_request_target workflow.");
  }
  const result = await checkSourcePullRequest({
    event: readEventFile(env.GITHUB_EVENT_PATH),
    token: env.GITHUB_TOKEN ?? "",
    cwd: process.cwd(),
  });
  console.log(`Source task check ${result.state} for PR #${result.number} at ${result.head}.`);
  if (result.state === "skipped") {
    console.log(`Pull request ${result.reason}. No commit status was posted.`);
    return 0;
  }
  if (result.issues.length > 0) console.log(`Validation codes: ${result.issues.join(", ")}.`);
  return result.state === "success" ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Source task check failed.");
    process.exitCode = 2;
  }
}
