"use client";

import { useState } from "react";

const personas = [
  { id: "coordinator", label: "Coordinator", name: "Morgan Chen" },
  { id: "reader", label: "Reader", name: "Avery Stone" },
  { id: "other", label: "Other repository user", name: "Robin Patel" },
] as const;

type Persona = typeof personas[number]["id"];

export function LocalPersonas() {
  const [pending, setPending] = useState<Persona | null>(null);
  const [failed, setFailed] = useState(false);

  async function signIn(persona: Persona) {
    if (pending) return;
    setFailed(false);
    setPending(persona);
    try {
      const response = await fetch("/api/auth/nutshell/persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona }),
      });
      if (!response.ok) throw new Error();
      window.location.replace("/app");
    } catch {
      setFailed(true);
      setPending(null);
    }
  }

  return (
    <>
      <ul className="persona-list" aria-label="Local fixture identities" aria-busy={pending !== null}>
        {personas.map(({ id, label, name }) => (
          <li key={id}>
            <button
              className="persona-choice"
              type="button"
              aria-labelledby={`persona-label-${id}`}
              aria-describedby={`persona-name-${id}`}
              aria-disabled={pending !== null}
              onClick={() => void signIn(id)}
            >
              <span id={`persona-label-${id}`}>{label}</span>
              <span className="persona-name" id={`persona-name-${id}`}>{pending === id ? "Signing in…" : name}</span>
            </button>
          </li>
        ))}
      </ul>
      {pending && <span className="sr-only" role="status">Signing in…</span>}
      {failed && <p role="alert">Couldn’t sign in. Try again.</p>}
    </>
  );
}
