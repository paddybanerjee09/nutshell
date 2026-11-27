import { describe, expect, it, vi } from "vitest";
import { requestGitHubSignIn } from "./github-sign-in-request";

const origin = "https://nutshell.example.test";

function destination() {
  const target = new URL("https://github.com/login/oauth/authorize");
  target.search = new URLSearchParams({
    client_id: "Iv1.fixture-client", state: "fixture-state", redirect_uri: origin + "/api/auth/callback/github",
    code_challenge: "a".repeat(43), code_challenge_method: "S256",
  }).toString();
  return target;
}

describe("GitHub sign-in request", () => {
  it("posts only to the same-origin auth endpoint and returns the verified GitHub authorization URL", async () => {
    const remote = destination();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ url: remote.href, redirect: false }));
    await expect(requestGitHubSignIn(origin, fetcher)).resolves.toBe(remote.href);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [path, request] = fetcher.mock.calls[0]!;
    expect(path).toBe("/api/auth/sign-in/social");
    expect(request).toMatchObject({
      method: "POST", credentials: "same-origin", redirect: "error", cache: "no-store",
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(request?.body))).toEqual({
      provider: "github", callbackURL: origin + "/app", errorCallbackURL: origin + "/login?github=unavailable", disableRedirect: true,
    });
  });

  it("rejects an unexpected provider, path, callback, duplicate state, or missing S256 challenge", async () => {
    const wrongTarget = new URL(destination());
    wrongTarget.protocol = "http:";
    const wrongPath = new URL(destination());
    wrongPath.pathname = "/login";
    const wrongOrigin = new URL(destination());
    wrongOrigin.hostname = "github.com.example.test";
    const wrongCallback = new URL(destination());
    wrongCallback.searchParams.set("redirect_uri", "https://other.example.test/api/auth/callback/github");
    const duplicateState = new URL(destination());
    duplicateState.searchParams.append("state", "second-state");
    const noPkce = new URL(destination());
    noPkce.searchParams.delete("code_challenge_method");
    for (const target of [wrongTarget, wrongPath, wrongOrigin, wrongCallback, duplicateState, noPkce]) {
      await expect(requestGitHubSignIn(origin, async () => Response.json({ url: target.href })))
        .rejects.toThrow("Couldn’t start GitHub sign-in.");
    }
  });

  it("rejects non-HTTPS app entry, automatic redirects, and unavailable auth with one safe failure message", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("private-provider-response", { status: 503 }));
    await expect(requestGitHubSignIn("http://nutshell.example.test", fetcher)).rejects.toThrow("Couldn’t start GitHub sign-in.");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(requestGitHubSignIn(origin, fetcher)).rejects.toThrow("Couldn’t start GitHub sign-in.");
    await expect(requestGitHubSignIn(origin, async () => Response.redirect(destination()))).rejects.toThrow("Couldn’t start GitHub sign-in.");
  });
});
