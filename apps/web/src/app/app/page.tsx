import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listRepositories } from "@nutshell/server/runtime";
import { SiteHeader } from "../brand";
import { SignOut } from "./sign-out";

export const metadata: Metadata = { title: "Repositories" };
export const dynamic = "force-dynamic";

export default async function RepositorySelection() {
  const repositories = await listRepositories(await headers());
  if (!repositories) redirect("/login");

  return (
    <>
      <SiteHeader><SignOut /></SiteHeader>
      <main className="content-shell" id="content" tabIndex={-1}>
        <h1>Repositories</h1>
        {repositories.length === 0 ? (
          <p className="lede">No repositories are available to this identity.</p>
        ) : (
          <ul className="repository-list" aria-label="Available repositories">
            {repositories.map((repository) => (
              <li key={repository.id}>
                <a href={`/app/repos/${encodeURIComponent(repository.id)}`}>
                  <span>{repository.name}</span>
                  {repository.description && <small>{repository.description}</small>}
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
