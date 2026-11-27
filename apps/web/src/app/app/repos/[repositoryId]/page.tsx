import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { readRepository } from "@nutshell/server/runtime";
import { SiteHeader } from "../../../brand";
import { SignOut } from "../../sign-out";

export const metadata: Metadata = { title: "Repository" };
export const dynamic = "force-dynamic";

export default async function RepositoryPage({ params }: { params: Promise<{ repositoryId: string }> }) {
  const { repositoryId } = await params;
  const repository = await readRepository(await headers(), repositoryId);
  if (!repository) notFound();

  return (
    <>
      <SiteHeader><SignOut /></SiteHeader>
      <main className="content-shell" id="content" tabIndex={-1}>
        <a className="back-link" href="/app">Repositories</a>
        <h1>{repository.name}</h1>
        {repository.description && <p className="lede">{repository.description}</p>}
      </main>
    </>
  );
}
