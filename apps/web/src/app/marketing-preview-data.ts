import type { WorkspaceData, WorkspaceItem } from "./app/repos/[repositoryId]/workspace/workspace-data";
import { documentResolver, markdownLinks } from "./app/repos/[repositoryId]/workspace/workspace-markdown";

type PreviewNote = Extract<WorkspaceItem, { kind: "document" }>;

const demoRevision = "demo-orbit-garden";
const notes = [
  {
    title: "Mission brief",
    body: [
      "Orbit Garden tracks plant sensors aboard a model satellite. Use these notes to follow a simulated pass from contact window to sensor reading.",
      "## Follow a pass",
      "1. Check [[Ground station]] for the next contact window.\n2. Inspect [[Telemetry]] for the latest plant readings.\n3. Review [[Release checklist]] before a simulator run.",
      "The simulator sends a sample every 30 seconds during contact.",
    ],
  },
  {
    title: "Telemetry",
    body: [
      "Each sample records light, temperature, and soil moisture. Group readings by pass so a missing sample stays visible.",
      "## Sample format",
      '~~~json\n{ "pass": 12, "light_lux": 420, "soil_moisture_pct": 38 }\n~~~',
      "See [[Signal routing]] for the path from a sensor to the sample log.",
    ],
  },
  {
    title: "Signal routing",
    body: [
      "The model satellite buffers readings until the next contact window. The receiver checks the sample sequence before adding it to the log.",
      "## Missed signals",
      "Record a gap if the sequence skips a sample. The [[Ground station]] note explains how to check whether contact ended early.",
    ],
  },
  {
    title: "Ground station",
    body: [
      "A contact window starts when the simulator brings the model satellite into range. The receiver listens until the window closes.",
      "## Before contact",
      "Synchronize the simulator clock and clear the previous pass from the test receiver. Use [[Release checklist]] to verify the setup.",
    ],
  },
  {
    title: "Release checklist",
    body: [
      "- [ ] Reset the simulator clock.\n- [ ] Confirm one complete contact window.\n- [ ] Inspect the saved sample sequence.",
      "## Record the result",
      "Compare the log with [[Telemetry]] and record any missing samples before tagging a simulator build.",
    ],
  },
] as const;

const documents = notes.map(({ title, body }): PreviewNote => {
  const path = "nutshell-vault/demo/" + title + ".md";
  const markdown = ["# " + title, ...body].join("\n\n") + "\n";
  return { kind: "document", id: "document:" + path, title, path, source: markdown, markdown, properties: "",
    linkedItemIds: [], backlinkIds: [], words: (markdown.match(/\S+/gu) ?? []).length, characters: Array.from(markdown).length };
});
const resolveNote = documentResolver(documents);
const notesById = new Map(documents.map((note) => [note.id, note]));
for (const note of documents) {
  const linked = new Set<string>();
  for (const href of markdownLinks(note.markdown)) {
    const id = resolveNote(note.path, href);
    if (id && id !== note.id) linked.add(id);
  }
  note.linkedItemIds = [...linked];
  for (const id of linked) notesById.get(id)?.backlinkIds.push(note.id);
}

export const marketingPreviewDocumentId = documents[0]!.id;

export const marketingPreviewData: WorkspaceData = {
  repositoryId: demoRevision,
  repositoryName: "Orbit Garden",
  repositoryHref: "#product",
  canEdit: false,
  layoutKey: "nutshell.preview.orbit-garden",
  revision: demoRevision,
  headRevision: demoRevision,
  status: "current",
  initialItemId: marketingPreviewDocumentId,
  items: documents,
  changes: [],
};
