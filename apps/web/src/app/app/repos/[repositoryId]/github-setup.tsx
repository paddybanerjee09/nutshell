"use client";

import type { GitHubSetupReadResult } from "@nutshell/server/github-app";
import { useCallback, useEffect, useId, useState } from "react";

const unavailable = { status: "unavailable" } as const;

export function GitHubSetup({ repositoryId }: { repositoryId: string }) {
  const heading = useId();
  const endpoint = "/api/repos/" + encodeURIComponent(repositoryId) + "/github-setup";
  const [result, setResult] = useState<GitHubSetupReadResult | null>(null);
  const [opening, setOpening] = useState(false);

  const observe = useCallback(async (callerSignal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(90_000);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal });
      const observed = await response.json() as GitHubSetupReadResult;
      if (!callerSignal?.aborted) setResult(observed);
    } catch {
      if (!callerSignal?.aborted) setResult(unavailable);
    }
  }, [endpoint]);

  useEffect(() => {
    const request = new AbortController();
    void observe(request.signal);
    return () => request.abort();
  }, [observe]);

  async function open() {
    if (opening || result?.status !== "ready" || !result.canConfigure) return;
    setOpening(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({ sourceRevision: result.sourceRevision }),
      });
      setResult(await response.json() as GitHubSetupReadResult);
    } catch {
      setResult(unavailable);
    } finally {
      setOpening(false);
    }
  }

  function refresh() {
    setResult(null);
    void observe();
  }

  return <section className="setup-panel" aria-labelledby={heading} aria-busy={!result || opening}>
    <h2 id={heading}>Repository setup</h2>
    {!result && <p role="status">Checking GitHub setup…</p>}
    {result?.status === "ready" && <>
      <p>Setup source revision <code>{result.sourceRevision}</code></p>
      {result.canConfigure ? <button type="button" className="quiet-button" onClick={() => void open()} disabled={opening}>
        {opening ? "Opening GitHub pull request…" : "Create setup pull request"}
      </button> : <p>A current repository administrator can create the setup pull request.</p>}
    </>}
    {result?.status === "awaiting_merge" && <>
      <p role="status">Setup pull request awaiting merge.</p>
      <p><a className="back-link" href={result.url}>Open GitHub pull request #{result.number}</a></p>
      <p>Proposed revision <code>{result.head}</code></p>
    </>}
    {result?.status === "configured" && <p role="status">Nutshell files found at revision <code>{result.sourceRevision}</code>.</p>}
    {result?.status === "stale" && <p role="alert">GitHub moved to revision <code>{result.sourceRevision}</code>. Refresh before creating the proposal.</p>}
    {result?.status === "conflict" && <p role="alert">Existing setup files or the proposal changed. Review the repository and refresh setup.</p>}
    {result?.status === "forbidden" && <p role="alert">Creating setup requires current repository administration access.</p>}
    {result?.status === "unavailable" && <p role="alert">GitHub setup is unavailable. Check your access and refresh setup.</p>}
    {result && result.status !== "ready" && !opening && <button type="button" className="quiet-button" onClick={refresh}>Refresh setup</button>}
  </section>;
}
