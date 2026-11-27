import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const { loadConfig, handler } = vi.hoisted(() => ({
  loadConfig: vi.fn<() => { mode: "local-alpha" | "live"; origin: string }>(),
  handler: vi.fn<(request: Request) => Promise<Response>>(),
}));
vi.mock("@nutshell/server/config", () => ({ loadConfig }));
vi.mock("@nutshell/server/runtime", () => ({ getAuth: () => ({ handler }) }));

const origin = "https://nutshell.example.test";
const host = new URL(origin).host;

beforeEach(() => {
  loadConfig.mockReset().mockReturnValue({ mode: "live", origin });
  handler.mockReset().mockImplementation(async () => Response.json({ delegated: true }));
});

describe("mode-specific auth routing", () => {
  it("keeps the configured HTTPS callback URL and passes the original OAuth request to Better Auth", async () => {
    const response = await GET(new Request("http://internal/api/auth/callback/github?code=fixture&state=known", { headers: { host } }));
    expect(response.status).toBe(200);
    expect(handler.mock.calls[0]?.[0].url).toBe(origin + "/api/auth/callback/github?code=fixture&state=known");
    const body = JSON.stringify({ provider: "github" });
    const start = await POST(new Request("http://internal/api/auth/sign-in/social", {
      method: "POST", headers: { host, origin, "content-type": "application/json" }, body,
    }));
    expect(start.status).toBe(200);
    const delegated = handler.mock.calls[1]?.[0];
    expect(delegated?.url).toBe(origin + "/api/auth/sign-in/social");
    expect(delegated?.headers.get("origin")).toBe(origin);
    expect(await delegated?.text()).toBe(body);
  });

  it("hides local persona entry from live mode and preserves same-route delegation for local alpha", async () => {
    const request = (appOrigin: string) => new Request(appOrigin + "/api/auth/nutshell/persona", {
      method: "POST", headers: { host: new URL(appOrigin).host, origin: appOrigin, "content-type": "application/json" },
      body: '{"persona":"reader"}',
    });
    const denied = await POST(request(origin));
    expect(denied.status).toBe(404);
    expect(denied.headers.get("cache-control")).toMatch(/no-store/u);
    expect(handler).not.toHaveBeenCalled();
    const localOrigin = "http://127.0.0.1:3000";
    loadConfig.mockReturnValue({ mode: "local-alpha", origin: localOrigin });
    expect((await POST(request(localOrigin))).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fails closed for untrusted hosts, missing configuration, and thrown provider errors", async () => {
    const request = new Request(origin + "/api/auth/get-session", { headers: { host } });
    expect((await GET(new Request(request.url, { headers: { host: "other.example.test" } }))).status).toBe(421);
    loadConfig.mockImplementationOnce(() => { throw new Error("private configured connection"); });
    const disabled = await GET(request);
    expect(disabled.status).toBe(503);
    expect(await disabled.text()).not.toContain("private configured connection");
    expect(handler).not.toHaveBeenCalled();
    handler.mockRejectedValueOnce(new Error("provider details"));
    const unavailable = await GET(request);
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toMatch(/no-store/u);
    expect(await unavailable.text()).not.toContain("provider details");
  });

  it("maps a provider callback error to the fixed same-origin login screen", async () => {
    const response = await GET(new Request(origin + "/api/auth/error?error=private-provider-detail", { headers: { host } }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(origin + "/login?github=unavailable");
    expect(response.headers.get("cache-control")).toMatch(/no-store/u);
    expect(handler).not.toHaveBeenCalled();
  });
});
