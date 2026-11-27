import { BrandArtwork } from "./brand";
import { MarketingSectionLinks } from "./marketing-navigation";
import { MarketingPreview } from "./marketing-preview";
import "./marketing.css";

export default function HomePage() {
  return (
    <>
      <header className="marketing-header">
        <nav className="marketing-nav" aria-label="Main navigation">
          <a className="marketing-brand" href="/" aria-label="Nutshell home">
            <BrandArtwork className="marketing-brand-artwork" />
            <span>Nutshell</span>
          </a>
          <MarketingSectionLinks />
          <a className="marketing-sign-in" href="/login">Sign in</a>
        </nav>
      </header>
      <main className="marketing-page" id="content" tabIndex={-1}>
        <div className="marketing-intro">
          <h1><span>Your codebase.</span>{" "}<span>In a Nutshell.</span></h1>
          <p>Shared project memory, connected features, and clear change history for teams building with AI.</p>
          <a className="primary-cta" href="/login">Open local alpha</a>
        </div>
        <section className="marketing-showcase" id="product" aria-label="Workspace preview" tabIndex={-1}>
          <MarketingPreview />
        </section>
        <section className="marketing-how" id="how-it-works" aria-labelledby="how-it-works-title" tabIndex={-1}>
          <h2 id="how-it-works-title">How it works</h2>
          <dl>
            <div><dt>Read the vault</dt><dd>Open repository Markdown, follow wikilinks, and explore connections in the Memory Graph.</dd></div>
            <div><dt>Trace changes</dt><dd>Use the Product Map and History to see what changed and find the original source revision.</dd></div>
            <div><dt>Work with your team</dt><dd>Keep tasks and team notes in the repository workspace. Propose Markdown changes for review.</dd></div>
          </dl>
        </section>
      </main>
    </>
  );
}
