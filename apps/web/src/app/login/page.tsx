import type { Metadata } from "next";
import type { ReactNode } from "react";
import { BrandArtwork, SiteHeader } from "../brand";
import { entryMode } from "../entry-mode";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ github?: string | string[] }> }) {
  const mode = entryMode();
  let entry: ReactNode;
  if (mode === "local-alpha") {
    const { LocalPersonas } = await import("./personas");
    entry = <>
      <p className="lede">Choose a local fixture identity to open its repositories.</p>
      <LocalPersonas />
    </>;
  } else if (mode === "live") {
    const { GitHubSignIn } = await import("./github-sign-in");
    entry = <>
      <p className="lede">Sign in with GitHub to see the repositories you can access in Nutshell.</p>
      <GitHubSignIn initialFailure={(await searchParams).github === "unavailable"} />
    </>;
  } else {
    entry = <p className="lede" role="alert">Sign-in is unavailable. Try again later.</p>;
  }

  return (
    <>
      <SiteHeader />
      <main className="content-shell login-content" id="content" tabIndex={-1}>
        <BrandArtwork className="login-artwork" />
        <h1>Sign in</h1>
        {entry}
      </main>
    </>
  );
}
