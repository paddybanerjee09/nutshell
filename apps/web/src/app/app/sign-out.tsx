"use client";

import { useState } from "react";

export function SignOut() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    if (pending) return;
    setFailed(false);
    setPending(true);
    try {
      const response = await fetch("/api/auth/sign-out", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error();
      window.location.replace("/login");
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <div className="sign-out">
      <button className="quiet-button" type="button" aria-disabled={pending} onClick={() => void signOut()}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {failed && <p role="alert">Couldn’t sign out. Try again.</p>}
    </div>
  );
}
