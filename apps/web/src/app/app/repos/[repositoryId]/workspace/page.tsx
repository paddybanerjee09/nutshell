import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { canEditFixtureMarkdown } from "@nutshell/server/fixture-drafts";
import { readFixtureSnapshot } from "@nutshell/server/fixture-sync";
import { getSession, readGitHubWorkspace, readRepository } from "@nutshell/server/runtime";
import { entryMode } from "../../../../entry-mode";
import { hasIndexedSnapshot, workspaceData } from "./workspace-data";
import { WorkspaceShell } from "./workspace-shell";
import "./workspace.css";

export const metadata: Metadata = { title: "Workspace" };
export const dynamic = "force-dynamic";

export default async function WorkspacePage({ params, searchParams }: {
  params: Promise<{ repositoryId: string }>;
  searchParams: Promise<{ history?: string | string[]; note?: string | string[] }>;
}) {
  const mode = entryMode();
  if (mode === "unavailable") notFound();
  const { repositoryId } = await params;
  const request = await headers();
  if (mode === "live") {
    const live = await readGitHubWorkspace(request, repositoryId).catch(() => null);
    if (!live) notFound();
    if (!hasIndexedSnapshot(live.snapshot)) return <AwaitingIndex repository={live.repository} invalid={live.snapshot.status === "invalid"} />;
    const data = workspaceData(live.repository, live.userId, live.snapshot, false, "github");
    return <WorkspaceShell key={data.layoutKey} data={data} />;
  }
  const [session, repository, snapshot] = await Promise.all([
    getSession(request), readRepository(request, repositoryId), readFixtureSnapshot(request, repositoryId),
  ]);
  if (!session || !repository || !snapshot) notFound();

  if (!hasIndexedSnapshot(snapshot)) return <AwaitingIndex repository={repository} invalid={snapshot.status === "invalid"} />;

  const canEdit = await canEditFixtureMarkdown(request, repositoryId);
  const data = workspaceData(repository, session.user.id, snapshot, canEdit);
  const { history, note } = await searchParams;
  const initialHistory = typeof history === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/u.test(history) ? {
    changeId: history,
    ...(typeof note === "string" && note.length <= 512 ? { path: note } : {}),
  } : undefined;
  return <WorkspaceShell key={data.layoutKey} data={data} initialHistory={initialHistory} />;
}

function AwaitingIndex({ repository, invalid }: { repository: { id: string; name: string }; invalid: boolean }) {
  return <main className="content-shell" id="content" tabIndex={-1}>
    <a className="back-link" href={"/app/repos/" + repository.id}>Repository setup</a>
    <h1>{repository.name}</h1>
    <p className="lede">{invalid ? "The current repository head could not be indexed." : "This repository is waiting for its first indexed snapshot."}</p>
  </main>;
}
