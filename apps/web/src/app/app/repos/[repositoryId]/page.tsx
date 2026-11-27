import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { readFixtureOnboarding } from "@nutshell/server/fixture-onboarding";
import { readFixtureSnapshot } from "@nutshell/server/fixture-sync";
import { readRepository } from "@nutshell/server/runtime";
import { SiteHeader } from "../../../brand";
import { SignOut } from "../../sign-out";
import { RepositorySetup } from "./setup-panel";

export const metadata: Metadata = { title: "Repository" };
export const dynamic = "force-dynamic";

export default async function RepositoryPage({ params }: { params: Promise<{ repositoryId: string }> }) {
  const { repositoryId } = await params;
  const requestHeaders = await headers();
  const repository = await readRepository(requestHeaders, repositoryId);
  if (!repository) notFound();

  const setup = await readFixtureOnboarding(requestHeaders, repositoryId).catch(() => null);
  const snapshot = setup?.proposal?.status === "merged"
    ? await readFixtureSnapshot(requestHeaders, repositoryId).catch(() => null)
    : null;
  const sync = snapshot ? {
    status: snapshot.status,
    headRevision: snapshot.headRevision,
    revision: snapshot.revision,
  } : null;

  return (
    <>
      <SiteHeader><SignOut /></SiteHeader>
      <main className="content-shell" id="content" tabIndex={-1}>
        <a className="back-link" href="/app">Repositories</a>
        <h1>{repository.name}</h1>
        {repository.description && <p className="lede">{repository.description}</p>}
        <RepositorySetup repositoryId={repository.id} initialSetup={setup} initialSnapshot={sync} />
      </main>
    </>
  );
}
