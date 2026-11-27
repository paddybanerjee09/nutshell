import { createHmac, timingSafeEqual } from "node:crypto";
import { loadConfig } from "@nutshell/server/config";
import { acceptFixtureDelivery } from "@nutshell/server/fixture-sync";

export const runtime = "nodejs";

const maxBodyBytes = 64 * 1024;

function outcome(status: string, code: number) {
  return Response.json({ status }, { status: code, headers: { "Cache-Control": "no-store" } });
}

async function rawPayload(request: Request): Promise<Buffer | null> {
  if (Number(request.headers.get("content-length")) > maxBodyBytes) return null;
  if (!request.body) return Buffer.alloc(0);

  const payload = Buffer.alloc(maxBodyBytes);
  const reader = request.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return payload.subarray(0, size);
      if (value.byteLength > maxBodyBytes - size) {
        void reader.cancel().catch(() => {});
        return null;
      }
      payload.set(value, size);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
}

function readId(value: unknown) {
  if (!value || typeof value !== "object" || !("id" in value)) return null;
  return typeof value.id === "number" && Number.isSafeInteger(value.id) && value.id > 0 ? value.id : null;
}

function readPush(value: unknown) {
  if (!value || typeof value !== "object" || !("ref" in value) || !("after" in value) ||
    !("repository" in value) || !("installation" in value)) return null;
  const { ref, after, repository, installation } = value;
  if (typeof ref !== "string" || !ref.startsWith("refs/") || ref.length > 1_024 ||
    typeof after !== "string" || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(after)) return null;
  const repositoryId = readId(repository);
  const installationId = readId(installation);
  if (!repositoryId || !installationId) return null;
  const deleted = "deleted" in value ? value.deleted : false;
  if (typeof deleted !== "boolean") return null;
  return { ref, revision: after, repositoryId, installationId, deleted };
}

export async function POST(request: Request): Promise<Response> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig();
  } catch {
    return outcome("unavailable", 503);
  }
  if (config.mode !== "local-alpha" || config.deployment !== "local" || !config.webhookSecret) {
    return outcome("unavailable", 404);
  }

  const signature = /^sha256=([a-f0-9]{64})$/u.exec(request.headers.get("x-hub-signature-256") ?? "")?.[1];
  if (!signature) return outcome("unauthorized", 401);

  let payload: Buffer | null;
  try {
    payload = await rawPayload(request);
  } catch {
    return outcome("invalid", 400);
  }
  if (!payload) return outcome("too_large", 413);
  const digest = createHmac("sha256", config.webhookSecret).update(payload).digest();
  if (!timingSafeEqual(digest, Buffer.from(signature, "hex"))) return outcome("unauthorized", 401);

  const event = request.headers.get("x-github-event");
  const deliveryId = request.headers.get("x-github-delivery");
  if (!event || !/^[a-z_]{1,64}$/u.test(event) ||
    !deliveryId || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(deliveryId)) {
    return outcome("invalid", 400);
  }
  if (event !== "push") return outcome("ignored", 202);

  let push: ReturnType<typeof readPush>;
  try {
    push = readPush(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)));
  } catch {
    return outcome("invalid", 400);
  }
  if (!push) return outcome("invalid", 400);
  if (push.ref !== "refs/heads/main" || push.deleted || /^0+$/u.test(push.revision)) {
    return outcome("ignored", 202);
  }

  const { repositoryId, installationId, revision } = push;
  try {
    const status = await acceptFixtureDelivery({ deliveryId: deliveryId.toLowerCase(), repositoryId, installationId, revision });
    return outcome(status, status === "unavailable" ? 404 : 202);
  } catch {
    return outcome("unavailable", 503);
  }
}
