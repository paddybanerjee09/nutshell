import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RepositorySelection from "./app/page";
import RepositoryPage from "./app/repos/[repositoryId]/page";
import WorkspacePage from "./app/repos/[repositoryId]/workspace/page";
import LoginPage from "./login/page";

type Repository = { id: string; name: string; description: string; role?: string };
const { loadConfig, listRepositories, readRepository, fixtureOnboarding, fixtureSnapshot, session } = vi.hoisted(() => ({
  loadConfig: vi.fn<() => { mode: "local-alpha" | "live" }>(),
  listRepositories: vi.fn<() => Promise<Repository[] | null>>(),
  readRepository: vi.fn<() => Promise<Repository | null>>(),
  fixtureOnboarding: vi.fn(),
  fixtureSnapshot: vi.fn(),
  session: vi.fn(),
}));
vi.mock("@nutshell/server/config", () => ({ loadConfig }));
vi.mock("@nutshell/server/runtime", () => ({ listRepositories, readRepository, getSession: session }));
vi.mock("@nutshell/server/fixture-onboarding", () => ({ readFixtureOnboarding: fixtureOnboarding }));
vi.mock("@nutshell/server/fixture-sync", () => ({ readFixtureSnapshot: fixtureSnapshot }));
vi.mock("@nutshell/server/fixture-drafts", () => ({ canEditFixtureMarkdown: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not-found"); },
  redirect: (url: string) => { throw new Error("redirect " + url); },
}));
vi.mock("./brand", () => ({ BrandArtwork: () => null, SiteHeader: () => null }));
vi.mock("./app/repos/[repositoryId]/workspace/workspace-shell", () => ({ WorkspaceShell: () => null }));

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
    expect(empty).not.toContain(repo.name);

    listRepositories.mockResolvedValueOnce([repo]);
    const available = renderToStaticMarkup(await RepositorySelection());
    expect(available).toContain(repo.name);
    expect(available).toContain("GitHub role · maintain");
    listRepositories.mockResolvedValueOnce(null);
    await expect(RepositorySelection()).rejects.toThrow("redirect /login");
  });

  it("does not call fixture setup or workspace services on protected live routes", async () => {
    readRepository.mockResolvedValueOnce(null);
    await expect(RepositoryPage({ params })).rejects.toThrow("not-found");
    readRepository.mockResolvedValueOnce(repo);
    const overview = renderToStaticMarkup(await RepositoryPage({ params }));
    expect(overview).toContain(repo.name);
    expect(overview).toContain("Workspace indexing is unavailable");
    expect(overview).not.toContain("Setup pull request");
    await expect(WorkspacePage({ params, searchParams })).rejects.toThrow("not-found");
    expect(fixtureOnboarding).not.toHaveBeenCalled();
    expect(fixtureSnapshot).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
  });
});
