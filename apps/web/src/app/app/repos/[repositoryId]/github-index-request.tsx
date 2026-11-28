"use client";

import type { GitHubIndexRequestResult } from "@nutshell/server/github-live-sync";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function GitHubIndexRequest({ repositoryId }: { repositoryId: string }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<GitHubIndexRequestResult | null>(null);

  async function requestIndex() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setResult(null);
    try {
      const response = await fetch("/api/repos/" + encodeURIComponent(repositoryId) + "/github-index", {
        method: "POST", signal: AbortSignal.timeout(90_000),
      });
      const outcome = await response.json() as GitHubIndexRequestResult;
      setResult(outcome);
      if (outcome.status === "current") router.refresh();
    } catch {
      setResult({ status: "unavailable" });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return <div>
    <button type="button" className="setup-button" aria-disabled={pending} onClick={() => void requestIndex()}>
      {pending ? "Requesting indexing…" : "Index current revision"}
    </button>
    {result?.status === "queued" && <>
      <p role="status">Indexing is queued.</p>
      <dl className="setup-revision"><dt>Queued revision</dt><dd><code>{result.revision}</code></dd></dl>
      <button type="button" className="quiet-button" onClick={() => router.refresh()}>Check indexing status</button>
    </>}
    {result?.status === "current" && <p role="status">This revision is already indexed.</p>}
    {result?.status === "forbidden" && <p role="alert">Indexing requires current repository administration access.</p>}
    {result?.status === "unavailable" && <p role="alert">The indexing request could not be confirmed.</p>}
  </div>;
}
