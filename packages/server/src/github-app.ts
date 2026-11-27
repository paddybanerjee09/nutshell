import type { GitHubAppSettings } from "./github-app-auth.ts";
import { createGitHubAppRepository } from "./github-app-repository.ts";
import { createGitHubSetupAdapter } from "./github-app-setup.ts";
import { createGitHubAppTransport } from "./github-app-transport.ts";
import { createGitHubAppValidation } from "./github-app-validation.ts";

export { createGitHubAppAuthOptions, readGitHubAppSettings, type GitHubAppSettings } from "./github-app-auth.ts";
export { createGitHubAppDrizzleTokenStore, createGitHubAppUserTokens } from "./github-app-auth-tokens.ts";

export function createGitHubAppAdapter(app: GitHubAppSettings, options: { fetch?: typeof fetch; now?: () => number } = {}) {
  const transport = createGitHubAppTransport({
    appId: app.appId, privateKey: app.privateKey, clientId: app.clientId, fetch: options.fetch, now: options.now,
  });
  const repository = createGitHubAppRepository(transport);
  return {
    repository,
    setup: createGitHubSetupAdapter(transport, repository),
    validation: createGitHubAppValidation(repository),
  };
}
