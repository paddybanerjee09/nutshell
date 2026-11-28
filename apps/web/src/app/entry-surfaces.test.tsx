import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepositorySelection from "./app/page";
import RepositoryPage from "./app/repos/[repositoryId]/page";
import WorkspacePage from "./app/repos/[repositoryId]/workspace/page";
import LoginPage from "./login/page";

type Repository = { id: string; name: string; description: string; role?: string };
const { loadConfig, listRepositories, readRepository, readGitHubWorkspace, fixtureOnboarding, fixtureSnapshot, session } = vi.hoisted(() => ({
  loadConfig: vi.fn<() => { mode: "local-alpha" | "live" }>(),
  listRepositories: vi.fn<() => Promise<Repository[] | null>>(),
  readRepository: vi.fn<() => Promise<Repository | null>>(),
  readGitHubWorkspace: vi.fn(),
  fixtureOnboarding: vi.fn(),
  fixtureSnapshot: vi.fn(),
  session: vi.fn(),
}));
vi.mock("@nutshell/server/config", () => ({ loadConfig }));
vi.mock("@nutshell/server/runtime", () => ({ listRepositories, readRepository, readGitHubWorkspace, getSession: session }));
vi.mock("@nutshell/server/fixture-onboarding", () => ({ readFixtureOnboarding: fixtureOnboarding }));
vi.mock("@nutshell/server/fixture-sync", () => ({ readFixtureSnapshot: fixtureSnapshot }));
vi.mock("@nutshell/server/fixture-drafts", () => ({ canEditFixtureMarkdown: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not-found"); },
  redirect: (url: string) => { throw new Error("redirect " + url); },
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("./brand", () => ({ BrandArtwork: () => null, SiteHeader: () => null }));
vi.mock("./app/repos/[repositoryId]/workspace/workspace-shell", () => ({ WorkspaceShell: ({ data }: {
  data: { provider: string; canEdit: boolean; status: string; revision: string };
}) => <div data-provider={data.provider} data-edit={data.canEdit} data-status={data.status}>{data.revision}</div> }));

const repo = { id: "31", name: "Authorized GitHub example", description: "", role: "maintain" };
const params = Promise.resolve({ repositoryId: repo.id });
const searchParams = Promise.resolve({});

beforeEach(() => {
  vi.resetAllMocks();
  loadConfig.mockReturnValue({ mode: "live" });
});

describe("mode-specific entry surfaces", () => {
  it("renders live sign-in or local personas only for the configured mode", async () => {
    const live = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ github: "unavailable" }) }));
    expect(live).toContain("Continue with GitHub");
    expect(live).toContain("Couldn’t sign in with GitHub");
    expect(live).not.toMatch(/Local fixture identities|Coordinator|Other repository user/u);

    loadConfig.mockReturnValue({ mode: "local-alpha" });
    const local = renderToStaticMarkup(await LoginPage({ searchParams }));
    expect(local).toContain("Local fixture identities");
    expect(local).not.toContain("Continue with GitHub");

    loadConfig.mockImplementation(() => { throw new Error("private configuration error"); });
    const unavailable = renderToStaticMarkup(await LoginPage({ searchParams }));
    expect(unavailable).toContain("Sign-in is unavailable.");
    expect(unavailable).not.toMatch(/private configuration error|Local fixture identities|Continue with GitHub/u);
  });

  it("provides a safe live reconnect action and shows only an authorized repository role", async () => {
    listRepositories.mockResolvedValueOnce([]);
    const empty = renderToStaticMarkup(await RepositorySelection());
    expect(empty).toContain("Reconnect GitHub");
    expect(empty).toContain("check the repository association");
    expect(empty).toContain("Find GitHub repositories");
    expect(empty).not.toContain(repo.name);

    listRepositories.mockResolvedValueOnce([repo]);
    const available = renderToStaticMarkup(await RepositorySelection());
    expect(available).toContain(repo.name);
    expect(available).toContain("GitHub role · maintain");
    listRepositories.mockResolvedValueOnce(null);
    await expect(RepositorySelection()).rejects.toThrow("redirect /login");

    loadConfig.mockReturnValue({ mode: "local-alpha" });
    listRepositories.mockResolvedValueOnce([]);
    const local = renderToStaticMarkup(await RepositorySelection());
    expect(local).toContain("No repositories are available to this identity.");
    expect(local).not.toContain("Find GitHub repositories");
  });

  it("shows the pending live overview and denies unverified workspace access", async () => {
    readGitHubWorkspace.mockResolvedValueOnce(null);
    readRepository.mockResolvedValueOnce(null);
    await expect(RepositoryPage({ params })).rejects.toThrow("not-found");
    const pending = { repository: repo, userId: "reader", snapshot: {
      status: "pending", headRevision: "a".repeat(40), revision: null, snapshot: null, indexedAt: null,
    } };
    readGitHubWorkspace.mockResolvedValueOnce(pending);
    const overview = renderToStaticMarkup(await RepositoryPage({ params }));
    expect(overview).toContain(repo.name);
    expect(overview).toContain("Repository setup");
    expect(overview).toContain("Checking GitHub setup…");
    expect(overview).toContain("Waiting for the first indexed snapshot.");
    expect(overview).not.toContain("Open workspace");
    expect(overview).not.toContain("Setup pull request");
    readGitHubWorkspace.mockResolvedValueOnce(pending);
    const workspace = renderToStaticMarkup(await WorkspacePage({ params, searchParams }));
    expect(workspace).toContain("This repository is waiting for its first indexed snapshot.");
    readGitHubWorkspace.mockResolvedValueOnce(null);
    await expect(WorkspacePage({ params, searchParams })).rejects.toThrow("not-found");
    expect(readRepository).toHaveBeenCalledOnce();
    expect(fixtureOnboarding).not.toHaveBeenCalled();
    expect(fixtureSnapshot).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
  });

  it("preserves authorized setup access when live index status is unavailable", async () => {
    readGitHubWorkspace.mockResolvedValueOnce(null);
    readRepository.mockResolvedValueOnce(repo);
    const overview = renderToStaticMarkup(await RepositoryPage({ params }));
    expect(overview).toContain("Repository setup");
    expect(overview).toContain("Workspace indexing is unavailable.");
    expect(overview).not.toContain("Open workspace");
    expect(fixtureSnapshot).not.toHaveBeenCalled();
  });

  it("opens an authorized retained live workspace and shows which revision survived a failed head", async () => {
    const revision = "a".repeat(40);
    readGitHubWorkspace.mockResolvedValue({ repository: repo, userId: "reader", snapshot: {
      status: "invalid", revision, headRevision: "b".repeat(40), indexedAt: "2026-11-27T16:40:00Z",
      snapshot: { documents: [], entities: [], changes: [], config: { entity_kinds: [] } },
    } });
    const overview = renderToStaticMarkup(await RepositoryPage({ params }));
    expect(overview).toContain("The current GitHub revision could not be indexed.");
    expect(overview).toContain(revision);
    expect(overview).toContain('href="/app/repos/31/workspace">Open workspace');
    const workspace = renderToStaticMarkup(await WorkspacePage({ params, searchParams: Promise.resolve({ history: "ignored" }) }));
    expect(workspace).toContain('data-provider="github" data-edit="false" data-status="invalid"');
    expect(workspace).toContain(revision);
    expect(fixtureSnapshot).not.toHaveBeenCalled();
  });
});
