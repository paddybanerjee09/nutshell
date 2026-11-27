import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  draftFilter, fixtureDraftSourceBlob, isFixtureDraftPath, readEditableSource, readPublishedSource, readStoredDraft, serializeDraft,
  withDraftAccess, type DraftScope, type FixtureMarkdownDraft,
} from "./fixture-drafts.ts";
import { projectFixtureHistoryCandidate } from "./fixture-history-store.ts";
import {
  fixturePolicyVersion, fixtureSchemaVersion, isFixtureRevision, normalizeFixtureFiles, readFixtureTree,
  storeFixtureTree, writeFixtureHead, type DeliveryInput, type FixtureFile,
} from "./fixture-sync.ts";
import { fixtureDraftProposal, markdownDraft } from "./schema.ts";

const proposalIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const maxDraftVersion = 2_147_483_647;
const maxIssues = 32;

export type FixtureDraftProposal = {
  id: string;
  path: string;
  provider: "fixture";
  branch: string;
  status: "open" | "merged";
  baseRevision: string;
  sourceBlob: string;
  draftVersion: number;
  headRevision: string;
  mergeRevision: string | null;
};

export type ProposeFixtureDraftInput = { path: string; version: number; expectedHead?: string };
export type MergeFixtureDraftProposalInput = { path: string; proposalId: string; expectedHead: string };

type Rejection = { status: "unavailable" | "forbidden" | "invalid" };
type ProposalConflict = {
  status: "conflict";
  reason: "source" | "version" | "head";
  proposal: FixtureDraftProposal | null;
  draft: FixtureMarkdownDraft | null;
  currentRevision: string | null;
};
type CandidateIssue = { path: string; code: string; message: string };
type InvalidCandidate = { status: "invalid_candidate"; issues: CandidateIssue[] };
type ReadProposalResult = { status: "ready"; proposal: FixtureDraftProposal | null } | Rejection;
type OpenProposalResult = { status: "open" | "merged"; proposal: FixtureDraftProposal } | Rejection | ProposalConflict | InvalidCandidate;
type MergeProposalResult = { status: "merged"; proposal: FixtureDraftProposal; delivery: DeliveryInput } | Rejection | ProposalConflict | InvalidCandidate;
type StoredProposal = typeof fixtureDraftProposal.$inferSelect;
type CandidateBase = Pick<StoredProposal, "path" | "baseRevision" | "sourceBlob" | "draftVersion">;

function proposalScope({ repositoryId, epoch, userId }: DraftScope, path: string) {
  return and(eq(fixtureDraftProposal.repositoryId, repositoryId), eq(fixtureDraftProposal.connectionEpoch, epoch),
    eq(fixtureDraftProposal.userId, userId), eq(fixtureDraftProposal.path, path));
}

async function storedProposal(scope: DraftScope, path: string, id?: string) {
  const [proposal] = await scope.tx.select().from(fixtureDraftProposal)
    .where(and(proposalScope(scope, path), id ? eq(fixtureDraftProposal.id, id) : undefined))
    .orderBy(sql`(${fixtureDraftProposal.mergedRevision} is null) desc`, desc(fixtureDraftProposal.createdAt), desc(fixtureDraftProposal.id)).limit(1);
  return proposal;
}

function publicProposal(proposal: StoredProposal): FixtureDraftProposal {
  return {
    id: proposal.id, path: proposal.path, provider: "fixture", branch: `nutshell/draft-${proposal.id}`,
    status: proposal.mergedRevision ? "merged" : "open",
    baseRevision: proposal.baseRevision, sourceBlob: proposal.sourceBlob, draftVersion: proposal.draftVersion,
    headRevision: proposal.headRevision, mergeRevision: proposal.mergedRevision,
  };
}

async function proposalConflict(scope: DraftScope, path: string, reason: ProposalConflict["reason"], proposal: StoredProposal | undefined): Promise<ProposalConflict> {
  const published = await readPublishedSource(scope, path);
  const draft = await readStoredDraft(scope, path);
  return {
    status: "conflict", reason, proposal: proposal ? publicProposal(proposal) : null,
    draft: draft ? serializeDraft(draft) : null, currentRevision: published?.headRevision ?? null,
  };
}

function invalidCandidate(path: string, code: string, message: string): InvalidCandidate {
  return { status: "invalid_candidate", issues: [{ path, code, message }] };
}

async function validateCandidate({ tx, repositoryId }: DraftScope, files: FixtureFile[]): Promise<InvalidCandidate | null> {
  const { projection } = await projectFixtureHistoryCandidate(tx, repositoryId, files);
  return projection.ok ? null : { status: "invalid_candidate", issues: projection.issues.slice(0, maxIssues) };
}

function candidateHead(scope: DraftScope, base: CandidateBase, files: FixtureFile[]) {
  return createHash("sha256").update(JSON.stringify([
    "fixture draft head", scope.repositoryId, scope.epoch, scope.userId,
    base.path, base.baseRevision, base.sourceBlob, base.draftVersion, files.map(({ path, body }) => [path, body]),
  ])).digest("hex");
}

function mergedResult(scope: DraftScope, proposal: StoredProposal, revision: string): MergeProposalResult {
  return {
    status: "merged", proposal: publicProposal({ ...proposal, mergedRevision: revision }),
    delivery: { deliveryId: proposal.deliveryId, repositoryId: scope.repositoryId, installationId: scope.installationId, revision },
  };
}

export async function readFixtureDraftProposal(headers: Headers, repositoryId: string, path: string): Promise<ReadProposalResult> {
  if (!isFixtureDraftPath(path)) return { status: "invalid" };
  return withDraftAccess<ReadProposalResult>(headers, repositoryId, async (scope) => {
    const proposal = await storedProposal(scope, path);
    if (proposal) return { status: "ready", proposal: publicProposal(proposal) };
    const published = await readPublishedSource(scope, path);
    return published?.source != null ? { status: "ready", proposal: null } : { status: "unavailable" };
  });
}

export async function proposeFixtureDraft(headers: Headers, repositoryId: string, input: ProposeFixtureDraftInput): Promise<OpenProposalResult> {
  const { path, version, expectedHead } = input;
  if (!isFixtureDraftPath(path) || !Number.isInteger(version) || version < 1 || version > maxDraftVersion ||
      (expectedHead !== undefined && !isFixtureRevision(expectedHead))) return { status: "invalid" };

  return withDraftAccess<OpenProposalResult>(headers, repositoryId, async (scope) => {
    const { tx } = scope;
    const latest = await storedProposal(scope, path);
    const open = latest && !latest.mergedRevision ? latest : undefined;
    const current = await readEditableSource(scope, path);
    const hasDraft = current.status === "ready" ? Boolean(current.stored) : current.status === "conflict" && current.draft !== null;
    if (latest?.mergedRevision && !hasDraft && latest.draftVersion === version &&
        (expectedHead === undefined || expectedHead === latest.headRevision)) return { status: "merged", proposal: publicProposal(latest) };
    if (current.status === "conflict") return { ...current, proposal: open ? publicProposal(open) : null };
    if (current.status !== "ready") return current;
    const { sourceRevision: baseRevision, sourceBlob, stored } = current;
    if (open && (open.baseRevision !== baseRevision || open.sourceBlob !== sourceBlob)) return proposalConflict(scope, path, "source", open);
    if (!stored || stored.version !== version) return proposalConflict(scope, path, "version", open);

    if (open?.draftVersion === version && open.schemaVersion === fixtureSchemaVersion && open.policyVersion === fixturePolicyVersion &&
        (expectedHead === undefined || expectedHead === open.headRevision || expectedHead === open.previousHeadRevision)) {
      return { status: "open", proposal: publicProposal(open) };
    }
    if (expectedHead !== open?.headRevision) return proposalConflict(scope, path, "head", open);

    const baseFiles = await readFixtureTree(tx, scope.repositoryId, baseRevision);
    const baseFile = baseFiles?.find((file) => file.path === path);
    if (!baseFiles || !baseFile || fixtureDraftSourceBlob(baseFile.body) !== sourceBlob) return proposalConflict(scope, path, "source", open);
    if (baseFile.body === stored.markdown) return invalidCandidate(path, "draft-unchanged", "The saved draft has no change to publish.");

    let files: FixtureFile[];
    try {
      files = normalizeFixtureFiles(baseFiles.map((file) => file.path === path ? { path, body: stored.markdown } : file));
    } catch {
      return invalidCandidate(path, "draft-tree-limit", "The proposed tree exceeds the fixture provider text limits.");
    }
    const invalid = await validateCandidate(scope, files);
    if (invalid) return invalid;

    const base = { path, baseRevision, sourceBlob, draftVersion: version };
    const headRevision = candidateHead(scope, base, files);
    await storeFixtureTree(tx, scope.repositoryId, headRevision, files);
    const check = { headRevision, checkedRevision: headRevision, schemaVersion: fixtureSchemaVersion, policyVersion: fixturePolicyVersion };
    const [proposal] = open
      ? await tx.update(fixtureDraftProposal).set({ ...check, draftVersion: version, previousHeadRevision: open.headRevision }).where(and(
        proposalScope(scope, path), eq(fixtureDraftProposal.id, open.id), eq(fixtureDraftProposal.headRevision, open.headRevision),
        isNull(fixtureDraftProposal.mergedRevision),
      )).returning()
      : await tx.insert(fixtureDraftProposal).values({
        id: randomUUID(), deliveryId: randomUUID(), repositoryId: scope.repositoryId, connectionEpoch: scope.epoch,
        userId: scope.userId, ...base, ...check,
      }).returning();
    if (!proposal) throw new Error("The fixture proposal changed while its checked revision was being stored.");
    return { status: "open", proposal: publicProposal(proposal) };
  }, "update");
}

export async function mergeFixtureDraftProposal(headers: Headers, repositoryId: string, input: MergeFixtureDraftProposalInput): Promise<MergeProposalResult> {
  const { path, proposalId, expectedHead } = input;
  if (!isFixtureDraftPath(path) || typeof proposalId !== "string" || !proposalIdPattern.test(proposalId) ||
      !isFixtureRevision(expectedHead)) return { status: "invalid" };

  return withDraftAccess<MergeProposalResult>(headers, repositoryId, async (scope) => {
    const { tx, repositoryId } = scope;
    const proposal = await storedProposal(scope, path, proposalId);
    if (!proposal) return { status: "unavailable" };
    if (proposal.headRevision !== expectedHead) return proposalConflict(scope, path, "head", proposal);
    if (proposal.mergedRevision) return mergedResult(scope, proposal, proposal.mergedRevision);
    if (proposal.checkedRevision !== expectedHead || proposal.schemaVersion !== fixtureSchemaVersion ||
        proposal.policyVersion !== fixturePolicyVersion) return proposalConflict(scope, path, "head", proposal);

    const published = await readPublishedSource(scope, path);
    if (!published || published.headRevision !== proposal.baseRevision || published.sourceRevision !== proposal.baseRevision ||
        published.source === null || fixtureDraftSourceBlob(published.source) !== proposal.sourceBlob) return proposalConflict(scope, path, "source", proposal);

    const baseFiles = await readFixtureTree(tx, repositoryId, proposal.baseRevision);
    const baseFile = baseFiles?.find((file) => file.path === path);
    if (!baseFiles || !baseFile || fixtureDraftSourceBlob(baseFile.body) !== proposal.sourceBlob) return proposalConflict(scope, path, "source", proposal);
    const files = await readFixtureTree(tx, repositoryId, expectedHead);
    const target = files?.find((file) => file.path === path);
    if (!files || !target || files.length !== baseFiles.length || candidateHead(scope, proposal, files) !== expectedHead ||
        !files.every((file, index) => file.path === baseFiles[index]?.path && (file.path === path || file.body === baseFiles[index]?.body))) {
      return invalidCandidate(path, "draft-candidate-integrity", "The exact checked tree no longer matches the proposed file replacement.");
    }
    const invalid = await validateCandidate(scope, files);
    if (invalid) return invalid;

    const revision = createHash("sha256").update(JSON.stringify(["fixture draft merge", repositoryId, proposalId, proposal.baseRevision, expectedHead])).digest("hex");
    await storeFixtureTree(tx, repositoryId, revision, files);
    await writeFixtureHead(tx, repositoryId, revision);
    const [merged] = await tx.update(fixtureDraftProposal).set({ mergedRevision: revision }).where(and(
      proposalScope(scope, path), eq(fixtureDraftProposal.id, proposalId), eq(fixtureDraftProposal.headRevision, expectedHead),
      isNull(fixtureDraftProposal.mergedRevision),
    )).returning({ id: fixtureDraftProposal.id });
    if (!merged) throw new Error("The fixture proposal changed while its merge was being stored.");

    // Leave any later private edit available for recovery against its original base revision.
    await tx.delete(markdownDraft).where(and(draftFilter(scope, path), eq(markdownDraft.version, proposal.draftVersion),
      eq(markdownDraft.sourceRevision, proposal.baseRevision), eq(markdownDraft.sourceBlob, proposal.sourceBlob), eq(markdownDraft.markdown, target.body),
    ));
    return mergedResult(scope, proposal, revision);
  }, "update");
}
