import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { canEditFixtureMarkdown } from "@nutshell/server/fixture-drafts";
import { readFixtureSnapshot } from "@nutshell/server/fixture-sync";
import { getSession, readRepository } from "@nutshell/server/runtime";
import { hasIndexedSnapshot, workspaceData } from "./workspace-data";
import { WorkspaceShell } from "./workspace-shell";
import "./workspace.css";

export const metadata: Metadata = { title: "Workspace" };
export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params }: { params: Promise<{ repositoryId: string }> }) {
  const { repositoryId } = await params;
  const request = await headers();
  const [session, repository, snapshot] = await Promise.all([
    getSession(request), readRepository(request, repositoryId), readFixtureSnapshot(request, repositoryId),
  ]);
  if (!session || !repository || !snapshot) notFound();

  if (!hasIndexedSnapshot(snapshot)) return <main className="content-shell" id="content" tabIndex={-1}>
    <a className="back-link" href={"/app/repos/" + repository.id}>Repository setup</a>
    <h1>{repository.name}</h1>
    <p className="lede">{snapshot.status === "invalid" ? "The current repository head could not be indexed." : "This repository is waiting for its first indexed snapshot."}</p>
  </main>;

  const canEdit = await canEditFixtureMarkdown(request, repositoryId);
  const data = workspaceData(repository, session.user.id, snapshot, canEdit);
  return <WorkspaceShell key={data.layoutKey} data={data} />;
}
