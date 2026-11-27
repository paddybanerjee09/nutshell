import { z } from "zod";

export const maxTeamNoteContentBytes = 32 * 1024;
const maxStructureDepth = 24;
const maxStructureEntries = 2048;
const encoder = new TextEncoder();

function fitsNoteBudget(input: unknown): boolean {
  const pending = [{ value: input, depth: 0 }];
  let entries = 0;
  let textUnits = 0;
  while (pending.length) {
    const current = pending.pop();
    if (!current || ++entries > maxStructureEntries || current.depth > maxStructureDepth) return false;
    const { value, depth } = current;
    if (typeof value === "string") {
      textUnits += value.length;
      if (textUnits > maxTeamNoteContentBytes || !value.isWellFormed() || value.includes("\0")) return false;
    } else if (Array.isArray(value)) {
      if (value.length > maxStructureEntries - entries - pending.length) return false;
      for (const item of value) pending.push({ value: item, depth: depth + 1 });
    } else if (typeof value === "object" && value !== null) {
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return false;
      for (const key of Object.keys(value)) {
        textUnits += key.length;
        if (entries + pending.length >= maxStructureEntries || textUnits > maxTeamNoteContentBytes) return false;
        pending.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
      }
    } else if (value !== null && typeof value !== "boolean" && !Number.isFinite(value)) {
      return false;
    }
  }
  return encoder.encode(JSON.stringify(input)).byteLength <= maxTeamNoteContentBytes;
}

export function isSafeTeamNoteLink(href: string): boolean {
  if (href.length > 2048 || !/^https?:\/\/[^/]/iu.test(href) || /[\s\\\p{Cc}]/u.test(href)) return false;
  try {
    const url = new URL(href);
    return Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

const link = z.strictObject({
  type: z.literal("link"),
  attrs: z.strictObject({
    href: z.string().refine(isSafeTeamNoteLink, "Use an absolute HTTP(S) link."),
    target: z.literal("_blank").nullable().optional(),
    rel: z.enum(["noopener noreferrer", "noopener noreferrer nofollow"]).optional(),
    class: z.null().optional(),
    title: z.string().max(160).refine((title) => !/\p{Cc}/u.test(title)).nullable().optional(),
  }),
});

const marks = z.array(link).max(1).optional();

const text = z.strictObject({ type: z.literal("text"), text: z.string().min(1), marks });
const inline = z.discriminatedUnion("type", [text, z.strictObject({ type: z.literal("hardBreak"), marks })]);
const paragraph = z.strictObject({ type: z.literal("paragraph"), content: z.array(inline).optional() });
const heading = z.strictObject({
  type: z.literal("heading"),
  attrs: z.strictObject({ level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }),
  content: z.array(inline).optional(),
});
const codeBlock = z.strictObject({
  type: z.literal("codeBlock"),
  attrs: z.strictObject({ language: z.string().regex(/^[a-z\d._+#-]{1,32}$/iu).nullable().optional() }).optional(),
  content: z.array(z.strictObject({ type: z.literal("text"), text: z.string().min(1) })).optional(),
});

const orderedListAttrs = z.strictObject({
  start: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  type: z.enum(["1", "a", "A", "i", "I"]).nullable().optional(),
});
const taskItemAttrs = z.strictObject({ checked: z.boolean() });

type Paragraph = z.infer<typeof paragraph>;
type ListItem = { type: "listItem"; content: [Paragraph, ...Block[]] };
type TaskItem = { type: "taskItem"; attrs?: z.infer<typeof taskItemAttrs>; content: [Paragraph, ...Block[]] };
type Block = Paragraph | z.infer<typeof heading> | z.infer<typeof codeBlock>
  | { type: "bulletList"; content: ListItem[] }
  | { type: "orderedList"; attrs?: z.infer<typeof orderedListAttrs>; content: ListItem[] }
  | { type: "taskList"; content: TaskItem[] };

const block: z.ZodType<Block> = z.lazy(() => z.discriminatedUnion("type", [
  paragraph,
  heading,
  codeBlock,
  z.strictObject({ type: z.literal("bulletList"), content: z.array(listItem).min(1) }),
  z.strictObject({
    type: z.literal("orderedList"),
    attrs: orderedListAttrs.optional(),
    content: z.array(listItem).min(1),
  }),
  z.strictObject({ type: z.literal("taskList"), content: z.array(taskItem).min(1) }),
]));

const listItem = z.strictObject({ type: z.literal("listItem"), content: z.tuple([paragraph]).rest(block) });
const taskItem = z.strictObject({
  type: z.literal("taskItem"),
  attrs: taskItemAttrs.optional(),
  content: z.tuple([paragraph]).rest(block),
});

const versionOne = z.strictObject({
  schemaVersion: z.literal(1),
  doc: z.strictObject({ type: z.literal("doc"), content: z.array(block).min(1) }),
});

export const teamNoteContentSchema = z.unknown().refine(fitsNoteBudget, "Team note exceeds its JSON size or structure limits, or contains invalid Unicode.").pipe(versionOne);
export type TeamNoteContent = z.infer<typeof teamNoteContentSchema>;

export const emptyTeamNoteContent: TeamNoteContent = {
  schemaVersion: 1,
  doc: { type: "doc", content: [{ type: "paragraph" }] },
};
