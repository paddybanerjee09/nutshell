import { BrandArtwork, SiteHeader } from "./brand";

export default function HomePage() {
  return (
    <>
      <SiteHeader><a href="/login">Sign in</a></SiteHeader>
      <main className="hero" id="content" tabIndex={-1}>
        <div>
          <h1>Your codebase. In a Nutshell.</h1>
          <p>Shared project memory, connected features, and clear change history for teams building with AI.</p>
          <a className="primary-cta" href="/login">Open local alpha</a>
        </div>
        <BrandArtwork className="hero-artwork" />
      </main>
    </>
  );
}
