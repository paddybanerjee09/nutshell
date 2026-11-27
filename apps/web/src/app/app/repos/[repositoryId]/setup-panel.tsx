"use client";

import { useEffect, useRef, useState } from "react";
import type { FixtureOnboardingRead, FixtureSetupProposal } from "@nutshell/server/fixture-onboarding";
import type { FixtureSnapshotRead } from "@nutshell/server/fixture-sync";

type SnapshotStatus = Pick<FixtureSnapshotRead, "status" | "headRevision" | "revision">;
type SyncStatus = "pending" | "synced" | "invalid" | "superseded" | "paused";
type SetupAction = "open" | "merge";

function syncStatus(snapshot: SnapshotStatus | null, revision: string | null): SyncStatus {
  if (!snapshot || !revision) return "pending";
  if (snapshot.status === "current" && snapshot.revision === revision) return "synced";
  if (snapshot.headRevision && snapshot.headRevision !== revision) return "superseded";
  return snapshot.status === "invalid" ? "invalid" : "pending";
}

const mergeMessages: Record<SyncStatus, [string, string]> = {
  pending: ["Indexing repository", "The fixture merge is recorded. Waiting for its revision to be indexed."],
  synced: ["Repository synced", "The simulated setup merge is indexed."],
  invalid: ["Repository indexing failed", "Indexing failed for the simulated merge revision."],
  superseded: ["Repository revision changed", "The current repository head differs from the simulated merge revision."],
  paused: ["Repository sync pending", "The merge revision has yet to be confirmed. Reload the page to check its status."],
};

export function RepositorySetup({ repositoryId, initialSetup, initialSnapshot }: {
  repositoryId: string;
  initialSetup: FixtureOnboardingRead | null;
  initialSnapshot: SnapshotStatus | null;
}) {
  const [setup, setSetup] = useState(initialSetup);
  const [sync, setSync] = useState(() => syncStatus(initialSnapshot, initialSetup?.proposal?.mergeRevision ?? null));
  const [pending, setPending] = useState<SetupAction | null>(null);
  const [error, setError] = useState("");
  const [retryDelivery, setRetryDelivery] = useState(false);
  const statusHeading = useRef<HTMLHeadingElement>(null);
  const moveFocus = useRef(false);
  const api = "/api/repos/" + encodeURIComponent(repositoryId);
  const proposal = setup?.proposal;
  const mergeRevision = proposal?.mergeRevision ?? null;

  useEffect(() => {
    if (!mergeRevision || sync !== "pending" || retryDelivery) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const deadline = setTimeout(() => {
      controller.abort();
      setSync("paused");
    }, 20_000);

    async function check() {
      try {
        const response = await fetch(api + "/snapshot", { cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted) return;
        if (response.status === 404) {
          setSetup(null);
          return;
        }
        if (response.ok) {
          const next = syncStatus(await response.json() as SnapshotStatus, mergeRevision);
          if (controller.signal.aborted) return;
          if (next !== "pending") {
            setSync(next);
            return;
          }
        }
      } catch {
        // A transient request failure can recover before the polling deadline.
      }
      if (!controller.signal.aborted) retry = setTimeout(() => void check(), 1_000);
    }

    void check();
    return () => {
      controller.abort();
      clearTimeout(deadline);
      clearTimeout(retry);
    };
  }, [api, mergeRevision, retryDelivery, sync]);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    statusHeading.current?.focus({ preventScroll: true });
  }, [setup, sync]);

  async function submit(action: SetupAction) {
    if (pending || !setup?.canConfigure || (action === "merge" && !proposal)) return;
    setPending(action);
    setError("");
    try {
      const response = await fetch(api + "/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify(action === "merge" ? { action, expectedHead: proposal?.headRevision } : { action }),
      });
      if (response.status === 404) {
        setSetup(null);
        return;
      }
      if (response.status === 403) {
        setSetup({ ...setup, canConfigure: false });
        setError("Repository setup changes require current administrator access.");
        return;
      }
      if (response.status === 502 && action === "merge") {
        setRetryDelivery(true);
        return;
      }
      if (response.status === 409) {
        setError("The repository or setup proposal changed. Reload this page to review the latest revision.");
        return;
      }
      if (!response.ok) throw new Error();
      const result = await response.json() as { proposal: FixtureSetupProposal };
      moveFocus.current = true;
      setSetup({ ...setup, proposal: result.proposal });
      setRetryDelivery(false);
      setSync("pending");
    } catch {
      setError(action === "open"
        ? "Couldn’t create the setup proposal. Try again."
        : "Couldn’t confirm the simulated merge. Retry the same setup proposal.");
    } finally {
      setPending(null);
    }
  }

  let heading = "Setup unavailable";
  let detail = "Reload this page to check repository setup.";
  let action: SetupAction | null = null;
  let actionLabel = "";
  if (setup) {
    if (proposal?.status === "open") {
      heading = "Awaiting setup merge";
      detail = setup.canConfigure
        ? "Simulating a merge applies the setup proposal to this fixture repository."
        : "A repository administrator can simulate this setup merge.";
      action = "merge";
      actionLabel = "Simulate setup merge";
    } else if (proposal?.status === "merged") {
      [heading, detail] = mergeMessages[sync];
      if (sync === "paused" || retryDelivery) {
        action = "merge";
        actionLabel = "Retry setup sync";
      }
    } else if (setup.configured) {
      heading = "Repository already configured";
      detail = "Nutshell setup files are present on the default branch.";
    } else {
      heading = "Setup required";
      detail = setup.canConfigure
        ? "Create a setup proposal to add Nutshell files to this fixture repository."
        : "A repository administrator can create a setup proposal.";
      action = "open";
      actionLabel = "Create setup proposal";
    }
  }
  if (setup && retryDelivery) {
    heading = "Indexing delivery needs retry";
    detail = "The fixture merge was recorded, but indexing could not be queued. Retry the same proposal.";
  }
  const displayedRevision = mergeRevision ?? proposal?.headRevision;
  const revisionLabel = mergeRevision ? (sync === "synced" ? "Indexed revision" : "Merged revision") : "Proposal revision";
  const pendingLabel = pending === "open" ? "Creating setup proposal…" : "Sending simulated merge…";

  return (
    <section className="repository-setup" aria-labelledby="repository-setup-title">
      <h2 id="repository-setup-title">Repository setup</h2>
      <h3 ref={statusHeading} tabIndex={-1}>{heading}</h3>
      <p>{detail}</p>
      {displayedRevision && (
        <dl className="setup-revision" id="setup-revision">
          <dt>{revisionLabel}</dt>
          <dd><code>{displayedRevision}</code></dd>
        </dl>
      )}
      {setup?.canConfigure && action && (
        <button
          className="setup-button"
          type="button"
          aria-describedby={displayedRevision ? "setup-revision" : undefined}
          aria-disabled={pending !== null}
          onClick={() => void submit(action)}
        >
          {pending ? pendingLabel : actionLabel}
        </button>
      )}
      <span className="sr-only" role="status">{pending ? pendingLabel : heading}</span>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
