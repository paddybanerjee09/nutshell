import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { readFixtureOnboarding } from "@nutshell/server/fixture-onboarding";
import { readFixtureSnapshot } from "@nutshell/server/fixture-sync";
import { readGitHubWorkspace, readRepository } from "@nutshell/server/runtime";
import { SiteHeader } from "../../../brand";
import { entryMode } from "../../../entry-mode";
import { SignOut } from "../../sign-out";
import { GitHubIndexRequest } from "./github-index-request";
import { GitHubSetup } from "./github-setup";

export const metadata: Metadata = { title: "Repository" };
export const dynamic = "force-dynamic";

const liveIndexStatus = {
  pending: "Waiting for the first indexed snapshot.",
  current: "The current GitHub revision is indexed.",
  stale: "Showing the last valid snapshot while the current GitHub revision is pending.",
  invalid: "The current GitHub revision could not be indexed.",
} as const;

export default async function RepositoryPage({ params }: { params: Promise<{ repositoryId: string }> }) {
  const mode = entryMode();
  if (mode === "unavailable") notFound();
  const { repositoryId } = await params;
  const requestHeaders = await headers();
  const live = mode === "live" ? await readGitHubWorkspace(requestHeaders, repositoryId).catch(() => null) : null;
  const repository = live?.repository ?? await readRepository(requestHeaders, repositoryId).catch(() => null);
  if (!repository) notFound();

  let panel: ReactNode;
  if (mode === "live") {
    const snapshot = live?.snapshot;
    panel = <>
      <section aria-labelledby="github-access">
        <h2 id="github-access">GitHub access</h2>
        {"role" in repository && typeof repository.role === "string" && <p>GitHub role · {repository.role}</p>}
      </section>
      <GitHubSetup repositoryId={repository.id} />
      <section className="repository-setup" aria-labelledby="workspace-index">
        <h2 id="workspace-index">Workspace</h2>
        <p role="status">{snapshot ? liveIndexStatus[snapshot.status] : "Workspace indexing is unavailable."}</p>
        {snapshot?.revision && snapshot.snapshot && <>
          <dl className="setup-revision"><dt>Indexed revision</dt><dd><code>{snapshot.revision}</code></dd></dl>
          <a className="back-link" href={"/app/repos/" + encodeURIComponent(repository.id) + "/workspace"}>Open workspace</a>
        </>}
        {repository.role === "admin" && snapshot?.status !== "current" && <GitHubIndexRequest repositoryId={repository.id} />}
      </section>
    </>;
  } else {
    const { RepositorySetup } = await import("./setup-panel");
    const setup = await readFixtureOnboarding(requestHeaders, repositoryId).catch(() => null);
    const snapshot = await readFixtureSnapshot(requestHeaders, repositoryId).catch(() => null);
    const sync = snapshot ? { status: snapshot.status, headRevision: snapshot.headRevision, revision: snapshot.revision } : null;
    panel = <RepositorySetup repositoryId={repository.id} initialSetup={setup} initialSnapshot={sync} />;
  }

  return (
    <>
      <SiteHeader><SignOut /></SiteHeader>
      <main className="content-shell" id="content" tabIndex={-1}>
        <a className="back-link" href="/app">Repositories</a>
        <h1>{repository.name}</h1>
        {repository.description && <p className="lede">{repository.description}</p>}
        {panel}
      </main>
    </>
  );
}
