import { createHmac } from "node:crypto";

type FixturePushDelivery = { deliveryId: string; repositoryId: number; installationId: number; revision: string };

export async function sendFixturePush(origin: string, secret: string, delivery: FixturePushDelivery): Promise<boolean> {
  const body = JSON.stringify({ ref: "refs/heads/main", after: delivery.revision,
    repository: { id: delivery.repositoryId }, installation: { id: delivery.installationId } });
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  const result = await fetch(origin + "/api/github/webhook", {
    method: "POST", body, redirect: "error", signal: AbortSignal.timeout(8_000),
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
      "x-github-delivery": delivery.deliveryId,
      "x-hub-signature-256": "sha256=" + signature,
    },
  });
  const receipt = await result.json() as { status?: string };
  return result.status === 202 && (receipt.status === "accepted" || receipt.status === "duplicate");
}
