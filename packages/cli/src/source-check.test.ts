import { describe, expect, it, vi } from "vitest";
import { checkSourcePullRequest } from "./source-check.ts";
import type { readGitSnapshot } from "./vault-files.ts";

const repository = { id: 1467144605, full_name: "paddybanerjee09/nutshell", default_branch: "main" };
const number = 23;
const base = "a".repeat(40);
const head = "b".repeat(40);
const prUrl = `https://github.com/${repository.full_name}/pull/${number}`;
const api = `https://api.github.com/repos/${repository.full_name}`;
const context = "nutshell/source-task";
const taskPath = "nutshell-vault/CURRENT_TASK.md";
const indexPath = "nutshell-vault/_INDEX.md";
const taskId = "source-task-2026-11-26";
const branch = "feature/source-task";
const token = "fixture-ghs-token";

function pull(body: string | null = `Review purpose.\r\n\r\nNutshell task: ${taskId}`) {
  return {
    id: 3741,
    number,
    state: "open",
    html_url: prUrl,
    body,
    base: { repo: repository, sha: base, ref: "main" },
    head: { repo: repository, sha: head, ref: branch },
  };
}

function event(payload = pull()) {
  return { action: "synchronize", repository, number, pull_request: payload };
}

function provider(...pulls: unknown[]) {
  let read = 0;
  return vi.fn<typeof fetch>(async (_url, options) => {
    if (options?.method === "POST") return new Response(null, { status: 201 });
    return Response.json(pulls[read++]);
  });
}

const note = (id: string, metadata: string, decision = "") => `---
id: ${id}
date: 2026-11-26
status: active
tags: [memory]
${metadata}---

## Context

## Decision

${decision}

## Consequences

## Affected files
`;

function task(active: boolean, revision: number) {
  return note("control-current-task", `task_id: ${active ? taskId : "null"}
task_state: ${active ? "pr_open" : "idle"}
task_revision: ${revision}
repository_id: ${active ? repository.id : "null"}
branch: ${active ? branch : "null"}
base_branch: ${active ? "main" : "null"}
pr_number: ${active ? number : "null"}
pr_url: ${active ? prUrl : "null"}
lead_agent: ${active ? "fixture-lead" : "null"}
integration_checkout: ${active ? "/fixture/nutshell" : "null"}
last_verified_head: null
cleanup_pr_url: null
`);
}

const table = `| Path | Description | Status | Tags |
| --- | --- | --- | --- |
| [AGENTS.md](../AGENTS.md) | Instructions. | active | memory |
| [README.md](../README.md) | Handoff. | active | memory |
| [SPEC.md](../SPEC.md) | Requirements. | active | memory |
| [${indexPath}](_INDEX.md) | Vault catalog. | active | memory |
| [${taskPath}](CURRENT_TASK.md) | Current feature. | active | memory |`;

function snapshots(options: { revision?: number; index?: string } = {}) {
  return vi.fn<typeof readGitSnapshot>(async (_cwd, base, headRef) => ({
    kind: "git",
    base,
    head: headRef,
    files: new Map([
      ["AGENTS.md", "# Instructions"],
      ["README.md", "# Handoff"],
      ["SPEC.md", "# Requirements"],
      [indexPath, note("control-vault-index", "", options.index ?? table)],
      [taskPath, task(headRef === head, headRef === head ? (options.revision ?? 6) : 4)],
    ]),
  }));
}

describe("trusted GitHub source check", () => {
  it("checks both immutable snapshots and posts only to the verified PR head", async () => {
    const fetcher = provider(pull(), pull());
    const readSnapshot = snapshots();
    const result = await checkSourcePullRequest({ event: event(), token, cwd: "trusted", fetcher, readSnapshot });

    expect(result).toEqual({ state: "success", issues: [], head, number });
    expect(readSnapshot.mock.calls).toEqual([["trusted", base, base], ["trusted", base, head]]);
    expect(fetcher.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([
      [`${api}/pulls/${number}`, "GET"],
      [`${api}/pulls/${number}`, "GET"],
      [`${api}/statuses/${head}`, "POST"],
    ]);
    for (const [, options] of fetcher.mock.calls) {
      expect(options?.redirect).toBe("error");
      expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${token}`);
    }
    expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      context,
      state: "success",
      target_url: prUrl,
    });
  });

  it("publishes failure after the task transition and vault catalog both fail", async () => {
    const fetcher = provider(pull(), pull());
    const readSnapshot = snapshots({ revision: 4, index: table.replace("Handoff.", "") });
    const result = await checkSourcePullRequest({ event: event(), token, cwd: "trusted", fetcher, readSnapshot });

    if (result.state !== "failure") throw new Error(`Expected a failed validation, received ${result.state}.`);
    expect(result.issues).toContain("task-revision");
    expect(result.issues.some((code) => code.startsWith("index-"))).toBe(true);
    expect(fetcher.mock.lastCall?.[0]).toBe(`${api}/statuses/${head}`);
    expect(JSON.parse(String(fetcher.mock.lastCall?.[1]?.body))).toMatchObject({ context, state: "failure" });
  });

  it.each([null, `Nutshell task: ${taskId}\nNutshell task: ${taskId}`, `Nutshell task: ${taskId} `, `Nutshell task: ${taskId}\r`])(
    "requires exactly one well-formed task marker (%s)",
    async (body) => {
      const pr = pull(body);
      const fetcher = provider(pr, pr);
      const readSnapshot = snapshots();
      const result = await checkSourcePullRequest({ event: event(pr), token, cwd: "trusted", fetcher, readSnapshot });

      expect(result).toMatchObject({ state: "failure", issues: ["pr-task-marker"], head });
      expect(readSnapshot).not.toHaveBeenCalled();
    },
  );

  it("rejects foreign event repository identities before making requests", async () => {
    const pr = pull();
    pr.head.repo = { ...repository, id: repository.id + 1 };
    const fetcher = provider(pr);
    const readSnapshot = snapshots();
    await expect(checkSourcePullRequest({ event: event(pr), token, cwd: "trusted", fetcher, readSnapshot }))
      .rejects.toThrow("same-repository PR");
    expect(fetcher).not.toHaveBeenCalled();
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  describe.each([
    { phase: "before reading snapshots", afterSnapshots: false },
    { phase: "after reading snapshots", afterSnapshots: true },
  ])("$phase", ({ afterSnapshots }) => {
    const original = pull();
    const closed = { ...original, state: "closed" };
    const changedSha = "c".repeat(40);

    it.each([
      { change: "closed pull request", current: closed, reason: "closed" },
      { change: "changed base SHA", current: { ...original, base: { ...original.base, sha: changedSha } }, reason: "superseded" },
      { change: "changed head SHA", current: { ...original, head: { ...original.head, sha: changedSha } }, reason: "superseded" },
      { change: "edited description", current: pull("Nutshell task: different-task"), reason: "superseded" },
    ])("skips a $change without publishing a status", async ({ current, reason }) => {
      const fetcher = afterSnapshots ? provider(original, current) : provider(current);
      // A stale run must also suppress a failure that it has already computed.
      const readSnapshot = snapshots({ revision: 4 });
      const result = await checkSourcePullRequest({ event: event(original), token, cwd: "trusted", fetcher, readSnapshot });

      expect(result).toEqual({ state: "skipped", reason, number, head });
      expect(readSnapshot.mock.calls).toEqual(afterSnapshots ? [["trusted", base, base], ["trusted", base, head]] : []);
      expect(fetcher.mock.calls.map(([url, options]) => [url, options?.method])).toEqual(afterSnapshots
        ? [[`${api}/pulls/${number}`, "GET"], [`${api}/pulls/${number}`, "GET"]]
        : [[`${api}/pulls/${number}`, "GET"]]);
    });

    it.each([
      { change: "unexpected lifecycle state", current: { ...original, state: "merged" } },
      { change: "different closed pull request identity", current: { ...closed, id: closed.id + 1 } },
      { change: "different pull request number", current: { ...closed, number: number + 1, html_url: `https://github.com/${repository.full_name}/pull/${number + 1}` } },
      { change: "foreign closed pull request repository", current: { ...closed, head: { ...closed.head, repo: { ...repository, id: repository.id + 1 } } } },
      { change: "malformed closed pull request SHA", current: { ...closed, head: { ...closed.head, sha: "invalid" } } },
    ])("rejects a $change without publishing a status", async ({ current }) => {
      const fetcher = afterSnapshots ? provider(original, current) : provider(current);
      const readSnapshot = snapshots();
      await expect(checkSourcePullRequest({ event: event(original), token, cwd: "trusted", fetcher, readSnapshot })).rejects.toThrow();
      expect(readSnapshot).toHaveBeenCalledTimes(afterSnapshots ? 2 : 0);
      expect(fetcher).toHaveBeenCalledTimes(afterSnapshots ? 2 : 1);
      expect(fetcher.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
    });
  });

  it("rejects provider errors without including the response payload", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("private API error payload", { status: 403 }));
    await expect(checkSourcePullRequest({ event: event(), token, cwd: "trusted", fetcher, readSnapshot: snapshots() }))
      .rejects.toThrow(/^Unable to verify the current GitHub pull request \(403\)\.$/);
  });

  it("bounds provider response bodies before parsing them", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("x".repeat(1024 * 1024 + 1)));
    const readSnapshot = snapshots();
    await expect(checkSourcePullRequest({ event: event(), token, cwd: "trusted", fetcher, readSnapshot }))
      .rejects.toThrow("response exceeds the size limit");
    expect(readSnapshot).not.toHaveBeenCalled();
  });
});
