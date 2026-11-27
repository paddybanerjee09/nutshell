const startPath = "/api/auth/sign-in/social";
const callbackPath = "/api/auth/callback/github";
const authorizationPath = "/login/oauth/authorize";
const failureMessage = "Couldn’t start GitHub sign-in.";

function githubAuthorization(payload: unknown, origin: string) {
  if (!payload || typeof payload !== "object" || !("url" in payload) || typeof payload.url !== "string" ||
      payload.url.length > 4_096 || /[\s\p{Cc}]/u.test(payload.url)) throw new Error(failureMessage);
  const target = new URL(payload.url);
  if (target.origin !== "https://github.com" || target.pathname !== authorizationPath || target.username || target.password || target.hash) {
    throw new Error(failureMessage);
  }
  const field = (name: string) => {
    const values = target.searchParams.getAll(name);
    return values.length === 1 ? values[0]! : "";
  };
  if (field("redirect_uri") !== origin + callbackPath || !field("client_id") || !field("state") ||
      field("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/u.test(field("code_challenge"))) {
    throw new Error(failureMessage);
  }
  return target.href;
}

export async function requestGitHubSignIn(origin: string, send: typeof fetch = fetch): Promise<string> {
  try {
    const app = new URL(origin);
    if (app.protocol !== "https:" || app.origin !== origin) throw new Error(failureMessage);
    const response = await send(startPath, {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "github",
        callbackURL: origin + "/app",
        errorCallbackURL: origin + "/login?github=unavailable",
        disableRedirect: true,
      }),
    });
    if (!response.ok || response.redirected) throw new Error(failureMessage);
    return githubAuthorization(await response.json() as unknown, origin);
  } catch {
    throw new Error(failureMessage);
  }
}
