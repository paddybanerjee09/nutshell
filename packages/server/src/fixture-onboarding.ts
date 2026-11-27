import { createHash, randomUUID } from "node:crypto";
import { buildFixtureSetupTree } from "@nutshell/core/fixture-setup-tree";
import { and, eq } from "drizzle-orm";
import { projectFixtureHistoryCandidate } from "./fixture-history-store.ts";
import {
  fixturePolicyVersion, fixtureSchemaVersion, lockFixtureConnection, normalizeFixtureFiles,
  readFixtureTree, storeFixtureTree, writeFixtureHead, type DeliveryInput, type FixtureFile,
} from "./fixture-sync.ts";
import { fixtureRepositories } from "./local-fixtures.ts";
import { getFixtureDatabase, lockRepositoryGrant, resolveRepositoryActor, type FixtureTransaction } from "./runtime.ts";
import { fixtureSetupProposal, fixtureState } from "./schema.ts";

type FixtureRepository = (typeof fixtureRepositories)[number];
type StoredProposal = typeof fixtureSetupProposal.$inferSelect;
type SetupContext = {
  tx: FixtureTransaction;
  fixture: FixtureRepository;
  epoch: number;
  canConfigure: boolean;
};

export type FixtureSetupProposal = {
  id: string;
  provider: "fixture";
  status: "open" | "merged";
  baseRevision: string;
  headRevision: string;
  mergeRevision: string | null;
};

export type FixtureOnboardingRead = { canConfigure: boolean; configured: boolean; proposal: FixtureSetupProposal | null };

type MutationRejected = { status: "unavailable" | "forbidden" | "conflict" };
type OpenResult = { status: "open" | "merged"; proposal: FixtureSetupProposal } | MutationRejected;
type MergeResult = { status: "merged"; proposal: FixtureSetupProposal; delivery: DeliveryInput } | MutationRejected;

async function withSetupAccess<Result>(
  headers: Headers, repositoryId: string, lock: "share" | "update", perform: (context: SetupContext) => Promise<Result>,
): Promise<Result | null> {
  const fixture = fixtureRepositories.find(({ id }) => String(id) === repositoryId);
  if (!fixture) return null;
  const actor = await resolveRepositoryActor(headers);
  if (!actor) return null;

  return getFixtureDatabase().transaction(async (tx) => {
    const connection = await lockFixtureConnection(tx, fixture.id, fixture.installationId, lock);
    if (!connection) return null;
    const permission = await lockRepositoryGrant(tx, actor, fixture.id);
    if (!permission) return null;
    return perform({ tx, fixture, epoch: connection.epoch, canConfigure: permission.canConfigure });
  });
}

function revisionFor(...parts: (number | string | readonly FixtureFile[])[]) {
  const canonical = parts.map((part) => typeof part === "object" ? part.map(({ path, body }) => [path, body]) : part);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function proposalFilter({ fixture, epoch }: SetupContext) {
  return and(eq(fixtureSetupProposal.repositoryId, fixture.id), eq(fixtureSetupProposal.connectionEpoch, epoch));
}

async function storedProposal(context: SetupContext) {
  const [proposal] = await context.tx.select().from(fixtureSetupProposal).where(proposalFilter(context));
  return proposal;
}

function publicProposal(proposal: StoredProposal): FixtureSetupProposal {
  return {
    id: proposal.id,
    provider: proposal.provider,
    status: proposal.mergedRevision ? "merged" : "open",
    baseRevision: proposal.baseRevision,
    headRevision: proposal.headRevision,
    mergeRevision: proposal.mergedRevision,
  };
}

async function currentTree({ tx, fixture }: SetupContext) {
  const [state] = await tx.select({ revision: fixtureState.headRevision }).from(fixtureState)
    .where(eq(fixtureState.repositoryId, fixture.id));
  if (!state) return;
  const files = await readFixtureTree(tx, fixture.id, state.revision);
  if (!files) throw new Error("The fixture head points to a missing tree.");
  return { revision: state.revision, files };
}

function initialTree(fixture: FixtureRepository) {
  const files = [
    { path: "AGENTS.md", body: `# ${fixture.name} owner instructions\n\nPreserve the existing project documentation and keep fixture work local.\n` },
    { path: "README.md", body: `# ${fixture.name}\n\n${fixture.description}\n` },
    { path: "SPEC.md", body: `# ${fixture.name} requirements\n\n${fixture.description}\n` },
  ];
  return { revision: revisionFor("fixture initial tree", fixture.id, files), files };
}

async function validates({ tx, fixture }: SetupContext, files: readonly FixtureFile[]) {
  return (await projectFixtureHistoryCandidate(tx, fixture.id, files)).projection.ok;
}

export async function readFixtureOnboarding(headers: Headers, repositoryId: string): Promise<FixtureOnboardingRead | null> {
  return withSetupAccess(headers, repositoryId, "share", async (context) => {
    const proposal = await storedProposal(context);
    const current = proposal ? undefined : await currentTree(context);
    return {
      canConfigure: context.canConfigure,
      configured: current !== undefined && await validates(context, current.files),
      proposal: proposal ? publicProposal(proposal) : null,
    };
  });
}

export async function openFixtureSetup(headers: Headers, repositoryId: string): Promise<OpenResult> {
  const result = await withSetupAccess<OpenResult>(headers, repositoryId, "update", async (context) => {
    if (!context.canConfigure) return { status: "forbidden" };
    const { tx, fixture, epoch } = context;
    const existing = await storedProposal(context);
    if (existing?.mergedRevision) return { status: "merged", proposal: publicProposal(existing) };

    const base = await currentTree(context) ?? initialTree(fixture);
    if (existing?.baseRevision === base.revision && existing.schemaVersion === fixtureSchemaVersion && existing.policyVersion === fixturePolicyVersion) {
      return { status: "open", proposal: publicProposal(existing) };
    }
    if (await validates(context, base.files)) return { status: "conflict" };

    let files: FixtureFile[];
    try {
      files = normalizeFixtureFiles(buildFixtureSetupTree(base.files, {
        name: fixture.name, description: fixture.description, entityId: `ent_fixture_${fixture.id}`,
      }));
    } catch {
      return { status: "conflict" };
    }
    if (!await validates(context, files)) return { status: "conflict" };

    const headRevision = revisionFor("fixture setup head", fixture.id, base.revision, files);
    await storeFixtureTree(tx, fixture.id, base.revision, base.files);
    await storeFixtureTree(tx, fixture.id, headRevision, files);

    const check = { schemaVersion: fixtureSchemaVersion, policyVersion: fixturePolicyVersion, checkedRevision: headRevision };
    const revisions = { baseRevision: base.revision, headRevision, ...check };
    const [proposal] = await tx.insert(fixtureSetupProposal).values({
      repositoryId: fixture.id, connectionEpoch: epoch, id: randomUUID(), deliveryId: randomUUID(), ...revisions,
    }).onConflictDoUpdate({ target: [fixtureSetupProposal.repositoryId, fixtureSetupProposal.connectionEpoch], set: revisions }).returning();
    if (!proposal) throw new Error("The fixture setup proposal could not be stored.");
    return { status: "open", proposal: publicProposal(proposal) };
  });
  return result ?? { status: "unavailable" };
}

export async function simulateFixtureSetupMerge(headers: Headers, repositoryId: string, expectedHead: string): Promise<MergeResult> {
  const result = await withSetupAccess<MergeResult>(headers, repositoryId, "update", async (context) => {
    if (!context.canConfigure) return { status: "forbidden" };
    const { tx, fixture } = context;
    const proposal = await storedProposal(context);
    if (!proposal || proposal.headRevision !== expectedHead) return { status: "conflict" };

    let mergedRevision = proposal.mergedRevision;
    if (!mergedRevision) {
      const base = await currentTree(context) ?? initialTree(fixture);
      if (base.revision !== proposal.baseRevision || proposal.checkedRevision !== expectedHead ||
          proposal.schemaVersion !== fixtureSchemaVersion || proposal.policyVersion !== fixturePolicyVersion) return { status: "conflict" };
      const files = await readFixtureTree(tx, fixture.id, expectedHead);
      if (!files || revisionFor("fixture setup head", fixture.id, base.revision, files) !== expectedHead || !await validates(context, files)) {
        return { status: "conflict" };
      }

      mergedRevision = revisionFor("fixture setup merge", fixture.id, base.revision, expectedHead);
      await storeFixtureTree(tx, fixture.id, mergedRevision, files);
      await writeFixtureHead(tx, fixture.id, mergedRevision);
      await tx.update(fixtureSetupProposal).set({ mergedRevision }).where(proposalFilter(context));
    }

    return {
      status: "merged",
      proposal: publicProposal({ ...proposal, mergedRevision }),
      delivery: { deliveryId: proposal.deliveryId, repositoryId: fixture.id, installationId: fixture.installationId, revision: mergedRevision },
    };
  });
  return result ?? { status: "unavailable" };
}
