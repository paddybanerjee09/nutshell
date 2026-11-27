import { describe, expect, it } from "vitest";
import { emptyTeamNoteContent, isSafeTeamNoteLink, maxTeamNoteContentBytes, teamNoteContentSchema } from "./team-note-content.ts";

const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });
const text = (value: string) => ({ type: "text", text: value });
const item = (...content: unknown[]) => ({ type: "listItem", content });
const document = (...content: unknown[]) => ({ schemaVersion: 1, doc: { type: "doc", content } });
const linkedDocument = (attrs: Record<string, unknown>) => document(paragraph({ ...text("link"), marks: [{ type: "link", attrs }] }));

describe("team note content v1", () => {
  it("accepts the supported Tiptap nodes and preserves structured Unicode content", () => {
    const link = { type: "link", attrs: { href: "https://example.com/reference?q=%E9%9B%AA#next", target: "_blank",
      rel: "noopener noreferrer nofollow", class: null, title: null } };
    const note = document(
      { type: "heading", attrs: { level: 2 }, content: [text("Release 雪 🧭")] },
      paragraph(text(" Preserve spacing.  "), { type: "hardBreak" }, { ...text("Reference"), marks: [link] }),
      { type: "bulletList", content: [item(paragraph(text("Bullets")), { type: "orderedList", attrs: { start: 2, type: null },
        content: [item(paragraph(text("Nested numbered items")))] })] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { checked: true }, content: [paragraph(text("Prepared"))] }] },
      { type: "codeBlock", attrs: { language: "c++" }, content: [text("x < 2\nreturn x")] },
    );
    expect(teamNoteContentSchema.parse(note)).toEqual(note);
    expect(teamNoteContentSchema.parse(emptyTeamNoteContent)).toEqual(emptyTeamNoteContent);
  });

  it("restricts linked text to absolute HTTP(S) URLs with safe link attributes", () => {
    for (const href of ["http://127.0.0.1:3000/", "https://example.test/雪", "HTTPS://example.test"]) {
      expect(isSafeTeamNoteLink(href)).toBe(true);
    }
    for (const href of ["javascript:alert(1)", "data:text/plain,hello", "//example.test", "/relative", "https:example.test",
      "https:///example.test", "https://user@example.test", "http://example.test\\x", "https://exam\tple.test"]) {
      expect(isSafeTeamNoteLink(href)).toBe(false);
      expect(teamNoteContentSchema.safeParse(linkedDocument({ href }))).toHaveProperty("success", false);
    }
    const href = "https://example.test";
    for (const attrs of [{ href, rel: "opener" }, { href, target: "named" }, { href, class: "custom" }, { href, onclick: "handler" }]) {
      expect(teamNoteContentSchema.safeParse(linkedDocument(attrs))).toHaveProperty("success", false);
    }
  });

  it("rejects out-of-scope nodes, marks, versions, attributes and invalid nesting", () => {
    for (const input of [
      document(), { ...emptyTeamNoteContent, schemaVersion: 2 }, document({ type: "image", attrs: { src: "https://example.test" } }),
      document({ type: "heading", attrs: { level: 4 } }), document({ type: "paragraph", attrs: { class: "custom" } }),
      document(paragraph({ ...text("bold"), marks: [{ type: "bold" }] })), document(paragraph({ type: "codeBlock" })),
      document({ type: "bulletList", content: [item({ type: "heading", attrs: { level: 1 } })] }),
      document({ type: "taskList", content: [{ type: "taskItem", attrs: { checked: "true" }, content: [paragraph()] }] }),
      document({ type: "codeBlock", content: [{ type: "hardBreak" }] }),
    ]) {
      expect(teamNoteContentSchema.safeParse(input)).toHaveProperty("success", false);
    }
  });

  it("enforces byte size, structure limits and PostgreSQL JSON Unicode requirements", () => {
    let nested: unknown = paragraph(text("too deep"));
    for (let depth = 0; depth < 30; depth++) nested = { type: "bulletList", content: [item(paragraph(), nested)] };
    for (const input of [
      document(paragraph(text("雪".repeat(Math.ceil(maxTeamNoteContentBytes / 3))))),
      document(...Array.from({ length: 1024 }, () => paragraph(text("x")))), document(nested),
      document(paragraph(text("surrogate\uD800"))), document(paragraph(text("nul\0"))),
    ]) {
      expect(teamNoteContentSchema.safeParse(input)).toHaveProperty("success", false);
    }
  });
});
