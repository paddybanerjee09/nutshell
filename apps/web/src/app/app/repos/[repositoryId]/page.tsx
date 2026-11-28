import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { readFixtureOnboarding } from "@nutshell/server/fixture-onboarding";
import { readFixtureSnapshot } from "@nutshell/server/fixture-sync";
import { readRepository } from "@nutshell/server/runtime";
import { SiteHeader } from "../../../brand";
import { entryMode } from "../../../entry-mode";
import { SignOut } from "../../sign-out";
import { GitHubSetup } from "./github-setup";

export const metadata: Metadata = { title: "Repository" };
export const dynamic = "force-dynamic";

export default async function RepositoryPage({ params }: { params: Promise<{ repositoryId: string }> }) {
  const mode = entryMode();
  if (mode === "unavailable") notFound();
  const { repositoryId } = await params;
  const requestHeaders = await headers();
  const repository = await readRepository(requestHeaders, repositoryId).catch(() => null);
  if (!repository) notFound();

  let panel: ReactNode;
  if (mode === "live") {
    panel = <>
      <section aria-labelledby="github-access">
        <h2 id="github-access">GitHub access</h2>
        {"role" in repository && typeof repository.role === "string" && <p>GitHub role · {repository.role}</p>}
        <p className="lede" role="status">Workspace indexing is unavailable for this GitHub repository.</p>
      </section>
      <GitHubSetup repositoryId={repository.id} />
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
