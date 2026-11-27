import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadConfig } from "@nutshell/server/config";
import { BrandArtwork, SiteHeader } from "../brand";
import { LocalPersonas } from "./personas";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  if (loadConfig().mode !== "local-alpha") notFound();

  return (
    <>
      <SiteHeader />
      <main className="content-shell login-content" id="content" tabIndex={-1}>
        <BrandArtwork className="login-artwork" />
        <h1>Sign in</h1>
        <p className="lede">Choose a local fixture identity to open its repositories.</p>
        <LocalPersonas />
      </main>
    </>
  );
}
