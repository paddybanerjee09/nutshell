import { fork } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { loadLocalConfig } from "@nutshell/server/config";

const controlPath = ".local/runtime-control.json";
const startupTimeout = 90_000;
const drainTimeout = 12_000;
const forceTimeout = 5_000;

function launch(path: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = fork(path, args, { env, execArgv: [], stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const exited = new Promise<string>((resolve) => {
    child.once("exit", (code, signal) => resolve(path + " stopped (" + (signal ?? code) + ")."));
    child.on("error", (error) => {
      if (child.pid === undefined) resolve(path + " could not be launched: " + error.message);
    });
  });
  const ready = new Promise<void>((resolve) => {
    child.on("message", (value: unknown) => {
      if (value !== null && typeof value === "object" && "type" in value && value.type === "ready") resolve();
    });
  });
  return { path, child, exited, ready };
}

async function waitForExit(exited: Promise<string>, timeout: number) {
  const deadline = new AbortController();
  try {
    return await Promise.race([exited.then(() => true), delay(timeout, false, { signal: deadline.signal })]);
  } finally {
    deadline.abort();
  }
}

async function drain({ path, child, exited }: ReturnType<typeof launch>) {
  if (child.pid === undefined) return;
  if (child.connected) child.send({ type: "shutdown" }, () => {});
  if (await waitForExit(exited, drainTimeout)) return;
  try {
    child.kill("SIGKILL");
    if (await waitForExit(exited, forceTimeout)) return;
    throw new Error(`${path} (PID ${child.pid}) did not report exit after termination.`);
  } finally {
    // A missing exit notification must not keep the supervisor alive through its IPC or process handle.
    child.channel?.unref();
    child.unref();
  }
}

function describeFailure(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function stopAfterFailure(stop: () => Promise<void>, error: unknown): Promise<never> {
  try {
    await stop();
  } catch (cleanupError) {
    throw new AggregateError([error, cleanupError], `${describeFailure(error)}\n${describeFailure(cleanupError)}`, { cause: cleanupError });
  }
  throw error;
}

export async function startServices(env: NodeJS.ProcessEnv, optimized: boolean, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const config = loadLocalConfig(env);
  const children: ReturnType<typeof launch>[] = [];
  let stopped: Promise<void> | undefined;
  function stop() {
    stopped ??= Promise.allSettled(children.map(drain)).then((results) => {
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length) {
        throw new AggregateError(failures.map((result) => result.reason), failures.map((result) => describeFailure(result.reason)).join("\n"));
      }
    });
    return stopped;
  }
  const deadline = new AbortController();
  const startupSignal = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  try {
    children.push(launch("apps/web/src/serve.ts", optimized ? ["--optimized"] : [], env));
    children.push(launch("apps/worker/src/main.ts", [], env));
    const exited = Promise.race(children.map((child) => child.exited));
    const failOnExit = exited.then((message) => { throw new Error(message); });
    const timeout = delay(startupTimeout, undefined, { signal: startupSignal }).catch((error: unknown) => {
      throw signal?.aborted ? signal.reason : error;
    }).then(() => {
      throw new Error("Timed out starting the web and worker processes.");
    });
    await Promise.race([Promise.all(children.map((child) => child.ready)), failOnExit, timeout]);
    return { config, exited, stop };
  } catch (error) {
    return await stopAfterFailure(stop, error);
  } finally {
    deadline.abort();
  }
}

export async function runDevelopment(env: NodeJS.ProcessEnv) {
  const token = randomBytes(32).toString("base64url");
  const controller = new AbortController();
  const requestStop = () => controller.abort();
  const stopping = new Promise<void>((resolve) => {
    controller.signal.addEventListener("abort", () => resolve(), { once: true });
  });
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.url !== "/stop" || request.headers.authorization !== "Bearer " + token) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(202).end(requestStop);
  });
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  let services: Awaited<ReturnType<typeof startServices>> | undefined;
  let lease = false;
  async function release() {
    await services?.stop();
    if (lease) await unlink(controlPath);
  }
  try {
    services = await startServices(env, false, controller.signal);
    controller.signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unable to locate the local stop endpoint.");
    await mkdir(".local", { recursive: true });
    await writeFile(controlPath, JSON.stringify({ token, port: address.port, pid: process.pid }), { flag: "wx", mode: 0o600 });
    lease = true;
    console.log("Nutshell is ready at " + services.config.origin + " (database and worker ready).");
    const stopped = await Promise.race([stopping, services.exited]);
    if (typeof stopped === "string") throw new Error(stopped);
  } catch (error) {
    if (!controller.signal.aborted || error !== controller.signal.reason) await stopAfterFailure(release, error);
  } finally {
    process.removeListener("SIGINT", requestStop);
    process.removeListener("SIGTERM", requestStop);
    server.close();
  }
  await release();
}

export async function stopDevelopment() {
  let file: string;
  try {
    file = await readFile(controlPath, "utf8");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    console.log("The Nutshell development processes are stopped.");
    return;
  }
  const { token, port, pid } = JSON.parse(file) as { token: string; port: number; pid: number };
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || !/^[\w-]{43}$/.test(token) ||
      !Number.isSafeInteger(pid) || pid < 1) throw new Error("Invalid Nutshell runtime control file.");
  try {
    const response = await fetch("http://127.0.0.1:" + port + "/stop", {
      method: "POST",
      headers: { authorization: "Bearer " + token },
      redirect: "error",
      signal: AbortSignal.timeout(3_000),
    });
    if (response.status !== 202) throw new Error("Control endpoint did not accept the stop request.");
  } catch (error) {
    try {
      process.kill(pid, 0);
    } catch (state) {
      if (state instanceof Error && "code" in state && state.code === "ESRCH" && await readFile(controlPath, "utf8") === file) {
        await unlink(controlPath);
        console.log("Cleared the stopped runtime's control file.");
        return;
      }
    }
    throw error;
  }
  for (let elapsed = 0; elapsed <= drainTimeout + forceTimeout; elapsed += 250) {
    if (await readFile(controlPath, "utf8").catch(() => "") !== file) {
      console.log("The Nutshell development processes are stopped.");
      return;
    }
    await delay(250);
  }
  throw new Error("The Nutshell development processes are still stopping.");
}
