"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";

type Candidate = { repositoryId: number; installationId: number; owner: string; name: string };
type Discovery = { status: "ready"; installationUrl: string; candidates: Candidate[] };
const endpoint = "/api/github/connections";

function resultMessage(status: number) {
  if (status === 401) return "Reconnect GitHub to renew your authorization.";
  if (status === 403) return "Current GitHub and workspace permissions do not allow this connection.";
  if (status === 409) return "The repository connection changed. Refresh the list before trying again.";
  return "GitHub repository access is unavailable. Try again later.";
}

export function GitHubConnections() {
  const router = useRouter();
  const titleId = useId();
  const [data, setData] = useState<Discovery | null>(null);
  const [selection, setSelection] = useState("");
  const [pending, setPending] = useState<"list" | "connect" | null>(null);
  const [error, setError] = useState("");
  const key = (item: Candidate) => `${item.installationId}:${item.repositoryId}`;

  async function findRepositories() {
    if (pending) return;
    setPending("list");
    setError("");
    setData(null);
    setSelection("");
    try {
      const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(22_000) });
      if (!response.ok) return setError(resultMessage(response.status));
      const discovery = await response.json() as Discovery;
      if (discovery.status !== "ready" || !/^https:\/\/github\.com\/apps\/[a-z\d][a-z\d-]{0,99}\/installations\/new$/u.test(discovery.installationUrl)) {
        return setError(resultMessage(503));
      }
      setData(discovery);
    } catch {
      setError(resultMessage(503));
    } finally {
      setPending(null);
    }
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const match = data?.candidates.find((item) => key(item) === selection);
    if (!match || pending) return;
    setPending("connect");
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(22_000),
        body: JSON.stringify({ repositoryId: match.repositoryId, installationId: match.installationId }),
      });
      if (!response.ok) return setError(resultMessage(response.status));
      const result = await response.json() as { status: string; repositoryId: string };
      if (result.status !== "connected" || result.repositoryId !== String(match.repositoryId)) return setError(resultMessage(503));
      router.push("/app/repos/" + encodeURIComponent(result.repositoryId));
    } catch {
      setError(resultMessage(503));
    } finally {
      setPending(null);
    }
  }

  return <section className="github-connections" aria-labelledby={titleId} aria-busy={pending !== null}>
    <h2 id={titleId}>Connect GitHub repository</h2>
    <div className="github-connection-actions">
      <button type="button" className="quiet-button" onClick={() => void findRepositories()} disabled={pending !== null}>
        {pending === "list" ? "Finding GitHub repositories…" : data ? "Refresh GitHub repositories" : "Find GitHub repositories"}
      </button>
      {data && <a className="back-link" href={data.installationUrl}>Install Nutshell on GitHub</a>}
    </div>
    {data && (data.candidates.length ? <form onSubmit={(event) => void connect(event)}>
      <label>GitHub repository
        <select value={selection} onChange={(event) => setSelection(event.currentTarget.value)} disabled={pending !== null} required>
          <option value="">Choose a repository</option>
          {data.candidates.map((item) => <option key={key(item)} value={key(item)}>{item.owner}/{item.name}</option>)}
        </select>
      </label>
      <button type="submit" className="quiet-button" disabled={!selection || pending !== null}>
        {pending === "connect" ? "Connecting repository…" : "Connect repository"}
      </button>
    </form> : <p role="status">No private repositories are available through this GitHub App.</p>)}
    {error && <p role="alert">{error}</p>}
  </section>;
}
