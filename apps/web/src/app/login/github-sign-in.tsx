"use client";

import { useRef, useState } from "react";
import { useHydrated } from "../use-hydrated";
import { requestGitHubSignIn } from "./github-sign-in-request";

export function GitHubSignIn({ initialFailure = false }: { initialFailure?: boolean }) {
  const hydrated = useHydrated();
  const running = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(initialFailure);

  async function signIn() {
    if (running.current) return;
    running.current = true;
    setFailed(false);
    setPending(true);
    try {
      const destination = await requestGitHubSignIn(window.location.origin);
      window.location.assign(destination);
    } catch {
      running.current = false;
      setPending(false);
      setFailed(true);
    }
  }

  return (
    <>
      <button className="quiet-button" type="button" disabled={!hydrated} aria-disabled={pending}
        onClick={() => void signIn()}>
        {pending ? "Connecting to GitHub…" : "Continue with GitHub"}
      </button>
      {pending && <span className="sr-only" role="status">Connecting to GitHub…</span>}
      {failed && <p role="alert">Couldn’t sign in with GitHub. Try again.</p>}
    </>
  );
}
