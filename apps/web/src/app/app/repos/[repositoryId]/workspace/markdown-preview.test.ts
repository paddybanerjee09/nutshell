import { history, redo, undo } from "@codemirror/commands";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { markdownClipboardInput, markdownDecorations, markdownLineBreak, markdownLinkAt, markdownSyntax } from "./markdown-preview";

function editor(doc: string, selection?: EditorSelection) {
  const state = EditorState.create({ doc, selection, extensions: [EditorState.allowMultipleSelections.of(true),
    EditorState.lineSeparator.of(markdownLineBreak(doc)), markdownSyntax, history()] });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
}

function preview(state: EditorState, focused: boolean) {
  const hidden: string[] = [];
  const classes: string[] = [];
  markdownDecorations(state, 0, state.doc.length, focused).between(0, state.doc.length, (from, to, value) => {
    if (from < to && value.point) hidden.push(state.sliceDoc(from, to));
    if (value.spec.class) classes.push(value.spec.class);
  });
  return { hidden, classes };
}

describe("source-preserving Markdown preview", () => {
  it("hides parsed markers away from the caret and keeps YAML, escaped syntax and fenced code intact", () => {
    const text = ["---", "title: '[[Frontmatter]]'", "---", "## Heading", "**strong** and `inline`", "[[Note|Alias]]", "\\[[literal]]", "```md", "**fenced** [[literal]]", "```"].join("\n");
    const state = editor(text, EditorSelection.create([EditorSelection.cursor(text.indexOf("Heading"))]));
    const output = preview(state, true);
    expect(output.hidden).not.toContain("## ");
    expect(output.hidden.filter((marker) => marker === "**")).toHaveLength(2);
    expect(output.hidden).toContain("[[Note|");
    expect(output.hidden).toContain("]]");
    expect(output.classes).toEqual(expect.arrayContaining(["cm-md-yaml", "cm-md-heading cm-md-heading-2", "cm-md-wiki", "cm-md-code-block", "cm-md-inline-code"]));
    expect(markdownLinkAt(state, text.indexOf("literal"))).toBeUndefined();
    expect(markdownLinkAt(state, text.indexOf("Frontmatter"))).toBeUndefined();
    expect(markdownLinkAt(state, text.indexOf("Alias"))).toBe("#nutshell-note=Note");
    expect(state.sliceDoc()).toBe(text);
  });

  it("keeps multiple caret lines and selected ranges legible while hiding markers elsewhere", () => {
    const text = "## First\n**Second**\n[[Third]]\n*Fourth*";
    const state = editor(text, EditorSelection.create([
      EditorSelection.cursor(text.indexOf("First")),
      EditorSelection.range(text.indexOf("Second"), text.indexOf("Third") + 1),
    ]));
    expect(preview(state, true).hidden).toEqual(["*", "*"]);
    expect(preview(state, false).hidden).toEqual(["## ", "**", "**", "[[", "]]", "*", "*"]);
    expect(state.sliceDoc()).toBe(text);
  });

  it("preserves incomplete syntax and resolves only parser-recognized link text", () => {
    const text = "[Local](guide.md#intro) and [[Folder/Note#Topic|Alias]]\n\n[[unfinished\n\n`[[example]]`";
    const state = editor(text);
    expect(markdownLinkAt(state, text.indexOf("Local"))).toBe("guide.md#intro");
    expect(markdownLinkAt(state, text.indexOf("Alias"))).toBe("#nutshell-note=Folder%2FNote%23Topic");
    expect(markdownLinkAt(state, text.indexOf("unfinished"))).toBeUndefined();
    expect(markdownLinkAt(state, text.indexOf("example"))).toBeUndefined();
    expect(preview(state, false).hidden).not.toContain("[[unfinished");
  });

  it("leaves document history to CodeMirror across selection and multiline Unicode edits", () => {
    const text = "## Start\n\n[[Note]]\n";
    let state = editor(text);
    state = state.update({ selection: { anchor: text.indexOf("Note") } }).state;
    preview(state, true);
    expect(undo({ state, dispatch() {} })).toBe(false);
    const insert = "禅🙂\ne\u0301\n";
    state = state.update({ changes: { from: text.length, insert }, userEvent: "input.paste" }).state;
    expect(state.sliceDoc()).toBe(text + insert);
    expect(undo({ state, dispatch: (transaction) => { state = transaction.state; } })).toBe(true);
    expect(state.sliceDoc()).toBe(text);
    expect(redo({ state, dispatch: (transaction) => { state = transaction.state; } })).toBe(true);
    expect(state.sliceDoc()).toBe(text + insert);
  });

  it.each([
    ["short\ntext\n", "\n"],
    ["short\r\ntext\r\n", "\r\n"],
    ["short\rtext\r", "\r"],
    ["short\r\ntext\nline\r", "\n"],
  ])("round trips source separators and undoes multiline paste in %s", (text, separator) => {
    let state = editor(text);
    expect(state.lineBreak).toBe(separator);
    expect(state.sliceDoc()).toBe(text);
    const pasted = markdownClipboardInput("禅\n🙂", state);
    const inserted = state.toText(pasted);
    expect(inserted.lines).toBe(2);
    state = state.update({ changes: { from: state.doc.length, insert: inserted }, userEvent: "input.paste" }).state;
    expect(state.sliceDoc()).toBe(text + "禅" + separator + "🙂");
    expect(undo({ state, dispatch: (transaction) => { state = transaction.state; } })).toBe(true);
    expect(state.sliceDoc()).toBe(text);
  });
});
