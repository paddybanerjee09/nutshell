import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { startServices } from "./local-services.ts";

const { fork } = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("node:child_process", () => ({ fork }));
vi.mock("@nutshell/server/config", () => ({ loadLocalConfig: () => ({}) }));
vi.mock("node:timers/promises", () => ({
  setTimeout: (milliseconds: number, value: unknown, { signal }: { signal: AbortSignal }) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(value), milliseconds);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    }),
}));

function child(pid: number) {
  return Object.assign(new EventEmitter(), {
    pid,
    connected: true,
    send: vi.fn(),
    kill: vi.fn().mockReturnValue(true),
    unref: vi.fn(),
    channel: { unref: vi.fn() },
  });
}

afterEach(() => {
  vi.useRealTimers();
  fork.mockReset();
});

it("keeps the startup failure when forced cleanup never observes a child exiting", async () => {
  vi.useFakeTimers();
  const web = child(1000);
  const worker = child(1001);
  fork.mockReturnValueOnce(web).mockReturnValueOnce(worker);

  const failure = expect(startServices({}, true)).rejects.toThrow(
    "apps/worker/src/main.ts stopped (1).\napps/web/src/serve.ts (PID 1000) did not report exit after termination.",
  );
  worker.emit("exit", 1, null);
  await vi.advanceTimersByTimeAsync(17_000);
  await failure;

  expect(web.send).toHaveBeenCalledWith({ type: "shutdown" }, expect.any(Function));
  expect(web.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
  expect(web.unref).toHaveBeenCalledOnce();
  expect(web.channel.unref).toHaveBeenCalledOnce();
});

it("drains both children when canceled before readiness", async () => {
  const web = child(1000);
  const worker = child(1001);
  web.send.mockImplementation(() => web.emit("exit", 0, null));
  worker.send.mockImplementation(() => worker.emit("exit", 0, null));
  fork.mockReturnValueOnce(web).mockReturnValueOnce(worker);

  const controller = new AbortController();
  const reason = new Error("Startup canceled.");
  const failure = expect(startServices({}, false, controller.signal)).rejects.toBe(reason);
  controller.abort(reason);
  await failure;

  expect(web.send).toHaveBeenCalledOnce();
  expect(worker.send).toHaveBeenCalledOnce();
  expect(web.kill).not.toHaveBeenCalled();
  expect(worker.kill).not.toHaveBeenCalled();
});
