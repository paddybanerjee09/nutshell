import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { listRepositories } from "@nutshell/server/runtime";
import { SiteHeader } from "../brand";
import { entryMode } from "../entry-mode";
import { SignOut } from "./sign-out";

export const metadata: Metadata = { title: "Repositories" };
export const dynamic = "force-dynamic";

export default async function RepositorySelection() {
  const mode = entryMode();
  if (mode === "unavailable") redirect("/login");
  const repositories = await listRepositories(await headers()).catch(() => undefined);
  if (repositories === null) redirect("/login");

  return (
    <>
      <SiteHeader><SignOut /></SiteHeader>
      <main className="content-shell" id="content" tabIndex={-1}>
        <h1>Repositories</h1>
        {repositories === undefined ? (
          <p className="lede" role="alert">Repository access is unavailable. Try again later.</p>
        ) : repositories.length === 0 ? (
          mode === "live" ? <>
            <p className="lede">No repositories are available to this GitHub account.</p>
            <p>Reconnect GitHub to renew authorization, or check the repository association with your workspace coordinator.</p>
            <a className="back-link" href="/login">Reconnect GitHub</a>
          </> : <p className="lede">No repositories are available to this identity.</p>
        ) : (
          <ul className="repository-list" aria-label="Available repositories">
            {repositories.map((repository) => (
              <li key={repository.id}>
                <a href={`/app/repos/${encodeURIComponent(repository.id)}`}>
                  <span>{repository.name}</span>
                  {repository.description && <small>{repository.description}</small>}
                  {mode === "live" && "role" in repository && typeof repository.role === "string" && <small>GitHub role · {repository.role}</small>}
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
