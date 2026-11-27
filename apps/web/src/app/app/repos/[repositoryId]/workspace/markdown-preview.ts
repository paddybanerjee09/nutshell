import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from "@codemirror/view";
import { GFM, type MarkdownConfig } from "@lezer/markdown";
import { wikiLinkHref } from "./workspace-markdown";

const wikiLink: MarkdownConfig = {
  defineNodes: ["WikiLink", "WikiTarget", "WikiAlias"],
  parseInline: [{
    name: "WikiLink",
    before: "Link",
    parse(context, next, position) {
      if (next !== 91 || context.char(position + 1) !== 91 || context.hasOpenLink) return -1;
      const match = /^\[\[([^\\\r\n|\]]{1,512})(?:\|([^\\\r\n\]]{1,256}))?\]\]/u.exec(
        context.slice(position, Math.min(context.end, position + 773)),
      );
      const rawTarget = match?.[1];
      const target = rawTarget?.trim();
      if (!match || !rawTarget || !target) return -1;
      const targetStart = position + 2 + rawTarget.indexOf(target);
      const label = match[2];
      const children = [context.elt("WikiTarget", targetStart, targetStart + target.length)];
      const alias = label?.trim();
      if (label && alias) {
        const labelStart = position + 3 + rawTarget.length + label.indexOf(alias);
        children.push(context.elt("WikiAlias", labelStart, labelStart + alias.length));
      }
      return context.addElement(context.elt("WikiLink", position, position + match[0].length, children));
    },
  }],
};

export const markdownSyntax = markdown({ extensions: [GFM, wikiLink] });

export function markdownLineBreak(text: string) {
  const first = /\r\n?|\n/u.exec(text)?.[0];
  if (first === "\r\n" && !/(?<!\r)\n|\r(?!\n)/u.test(text)) return "\r\n";
  if (first === "\r" && !text.includes("\n")) return "\r";
  // In mixed text, literal carriage returns stay in the document as visible control characters.
  return "\n";
}

export function markdownClipboardInput(text: string, state: EditorState) {
  return state.lineBreak === "\n" ? text : text.replace(/\r\n?|\n/gu, state.lineBreak);
}

class ListBullet extends WidgetType {
  toDOM(view: EditorView) {
    const bullet = view.dom.ownerDocument.createElement("span");
    bullet.className = "cm-md-bullet";
    bullet.textContent = "•";
    bullet.setAttribute("aria-hidden", "true");
    return bullet;
  }
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new ListBullet() });
const spans = new Map([
  ["Emphasis", "cm-md-emphasis"],
  ["StrongEmphasis", "cm-md-strong"],
  ["Strikethrough", "cm-md-strike"],
  ["InlineCode", "cm-md-inline-code"],
]);

function frontmatterEnd(state: EditorState) {
  const first = state.doc.line(1).text.replace(/^\uFEFF/u, "").replace(/\r$/u, "");
  if (first !== "---") return 0;
  for (let number = 2; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    if (line.to > 8_192) break;
    if (line.text.replace(/\r$/u, "") === "---") return line.to;
  }
  return 0;
}

export function markdownDecorations(state: EditorState, from: number, to: number, focused: boolean) {
  const decorations: Range<Decoration>[] = [];
  const protectedLines = focused ? state.selection.ranges.map(({ from, to }) => ({
    first: state.doc.lineAt(from).number, last: state.doc.lineAt(to).number,
  })) : [];
  const yamlEnd = frontmatterEnd(state);
  const protects = (number: number) => protectedLines.some(({ first, last }) => first <= number && last >= number);

  function replace(start: number, end: number, decoration = hide) {
    while (start < end) {
      const line = state.doc.lineAt(start);
      const limit = Math.min(line.to, end);
      if (limit > start && !protects(line.number)) decorations.push(decoration.range(start, limit));
      start = limit + 1;
    }
  }

  function mark(className: string, start: number, end: number) {
    if (end > start) decorations.push(Decoration.mark({ class: className }).range(start, end));
  }

  function markLines(className: string, start: number, end: number) {
    if (end < from || start > to) return;
    const first = state.doc.lineAt(Math.max(start, from));
    const last = state.doc.lineAt(Math.min(end, to));
    for (let number = first.number; number <= last.number; number += 1) {
      decorations.push(Decoration.line({ class: className }).range(state.doc.line(number).from));
    }
  }

  if (yamlEnd) markLines("cm-md-yaml", 0, yamlEnd);
  const tree = ensureSyntaxTree(state, to, 20) ?? syntaxTree(state);
  tree.iterate({
    from, to,
    enter({ name, from: start, to: end, node }) {
      if (yamlEnd && start <= yamlEnd && name !== "Document") return false;
      const style = spans.get(name);
      if (style) mark(style, start, end);
      if (/^(?:ATX|Setext)Heading[1-6]$/u.test(name)) {
        markLines("cm-md-heading cm-md-heading-" + name.at(-1), start, start);
      } else if (name === "HeaderMark") {
        const after = state.sliceDoc(end, state.doc.lineAt(end).to);
        replace(start, end + (/^[\t ]*/u.exec(after)?.[0].length ?? 0));
      } else if (name === "EmphasisMark" || name === "StrikethroughMark") {
        replace(start, end);
      } else if (name === "FencedCode" || name === "CodeBlock") {
        markLines("cm-md-code-block", start, end);
      } else if (name === "CodeMark") {
        if (node.parent?.name === "InlineCode" || node.parent?.getChildren("CodeMark").length === 2) replace(start, end);
      } else if (name === "ListMark") {
        if (/^[-+*]$/u.test(state.sliceDoc(start, end))) replace(start, end, bullet);
        else mark("cm-md-bullet", start, end);
      } else if (name === "WikiLink") {
        const label = node.getChild("WikiAlias") ?? node.getChild("WikiTarget");
        if (label) {
          mark("cm-md-wiki", label.from, label.to);
          replace(start, label.from);
          replace(label.to, end);
        }
        return false;
      } else if (name === "Link" || name === "Autolink") {
        const marks = node.getChildren("LinkMark");
        const url = node.getChild("URL");
        const [open, close] = marks;
        if (url && open && close) {
          mark("cm-md-link", open.to, close.from);
          replace(start, open.to);
          replace(close.from, end);
        }
      }
    },
  });
  return Decoration.set(decorations, true);
}

export function markdownLinkAt(state: EditorState, position: number) {
  const yamlEnd = frontmatterEnd(state);
  if (position < 0 || position > state.doc.length || (yamlEnd > 0 && position <= yamlEnd)) return;
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, position + 1), 20) ?? syntaxTree(state);
  for (const side of [-1, 1] as const) {
    for (let node = tree.resolveInner(position, side); node; node = node.parent!) {
      if (node.name === "WikiLink") {
        const target = node.getChild("WikiTarget");
        if (target) return wikiLinkHref(state.sliceDoc(target.from, target.to).trim());
      } else if (node.name === "Link" || node.name === "Autolink") {
        const url = node.getChild("URL");
        if (url) return state.sliceDoc(url.from, url.to).replace(/^<|>$/gu, "");
      }
    }
  }
}

const liveDecorations = ViewPlugin.fromClass(class {
  decorations: ReturnType<typeof markdownDecorations>;
  private composing = false;
  private refresh: ReturnType<typeof setTimeout> | undefined;

  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }

  update(update: ViewUpdate) {
    if (update.view.compositionStarted) {
      this.composing = true;
      this.decorations = this.decorations.map(update.changes);
      return;
    }
    if (this.composing || update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.composing = false;
      this.decorations = this.build(update.view);
    }
  }

  finishComposition(view: EditorView) {
    clearTimeout(this.refresh);
    this.refresh = setTimeout(() => view.dispatch({}), 100);
  }

  destroy() { clearTimeout(this.refresh); }

  private build(view: EditorView) {
    return markdownDecorations(view.state, view.viewport.from, view.viewport.to, view.hasFocus);
  }
}, {
  decorations: (plugin) => plugin.decorations,
  eventObservers: { compositionend(_event, view) { this.finishComposition(view); } },
});

export const markdownLivePreview = liveDecorations;
