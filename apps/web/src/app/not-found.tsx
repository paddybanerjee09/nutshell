import { SiteHeader } from "./brand";

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="content-shell" id="content" tabIndex={-1}>
        <h1>Page unavailable</h1>
        <p className="lede">We couldn’t open this page.</p>
        <a className="back-link" href="/app">Go to repositories</a>
      </main>
    </>
  );
}
