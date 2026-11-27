"use client";

import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { drawSelection, EditorView, highlightSpecialChars, keymap } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { markdownClipboardInput, markdownLineBreak, markdownLinkAt, markdownLivePreview, markdownSyntax } from "./markdown-preview";
import "./markdown-editor.css";

type MarkdownEditorProps = {
  value: string;
  mode: "live" | "source";
  readOnly?: boolean;
  onChange: (value: string) => void;
  onFollowLink?: (href: string) => boolean;
};

const externalSource = Annotation.define<boolean>();

function editable(readOnly: boolean) {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({ "aria-readonly": String(readOnly) })];
}

function preview(mode: "live" | "source") {
  return mode === "live" ? markdownLivePreview : [];
}

function updateSource(view: EditorView, value: string) {
  const previous = view.state.doc.toString();
  const incoming = view.state.toText(value);
  const next = incoming.toString();
  let from = 0;
  while (from < previous.length && from < next.length && previous[from] === next[from]) from += 1;
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > from && nextEnd > from && previous[previousEnd - 1] === next[nextEnd - 1]) {
    previousEnd -= 1;
    nextEnd -= 1;
  }
  view.dispatch({
    changes: { from, to: previousEnd, insert: incoming.slice(from, nextEnd) },
    annotations: [externalSource.of(true), Transaction.addToHistory.of(false)],
  });
}

export function MarkdownEditor({ value, mode, readOnly = false, onChange, onFollowLink }: MarkdownEditorProps) {
  const parent = useRef<HTMLDivElement>(null);
  const initial = useRef({ value, mode, readOnly });
  const callbacks = useRef({ onChange, onFollowLink });
  const editor = useRef<{
    view: EditorView;
    mode: "live" | "source";
    readOnly: boolean;
    setSource: (value: string, mode: "live" | "source", readOnly: boolean) => void;
  } | null>(null);

  useEffect(() => { callbacks.current = { onChange, onFollowLink }; }, [onChange, onFollowLink]);

  useEffect(() => {
    const modeConfig = new Compartment();
    const accessConfig = new Compartment();

    function follow(view: EditorView, position: number | null) {
      if (position === null || !callbacks.current.onFollowLink) return false;
      const href = markdownLinkAt(view.state, position);
      return Boolean(href && callbacks.current.onFollowLink(href));
    }

    function stateFor(value: string, mode: "live" | "source", readOnly: boolean) {
      return EditorState.create({
        doc: value,
        extensions: [
          EditorState.lineSeparator.of(markdownLineBreak(value)),
          EditorState.allowMultipleSelections.of(true),
          EditorView.contentAttributes.of({ "aria-label": "Markdown editor", "aria-multiline": "true", spellcheck: "false", tabindex: "0" }),
          EditorView.clipboardInputFilter.of(markdownClipboardInput),
          EditorView.lineWrapping,
          markdownSyntax,
          highlightSpecialChars(),
          history(),
          search(),
          drawSelection(),
          keymap.of([
            { key: "Mod-Enter", run: (view) => follow(view, view.state.selection.main.head) },
            ...searchKeymap,
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.domEventHandlers({
            mousedown(event, view) {
              return (event.metaKey || event.ctrlKey) && event.button === 0 &&
                follow(view, view.posAtCoords({ x: event.clientX, y: event.clientY }));
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && update.transactions.some((transaction) => !transaction.annotation(externalSource))) {
              callbacks.current.onChange(update.state.sliceDoc());
            }
          }),
          modeConfig.of(preview(mode)),
          accessConfig.of(editable(readOnly)),
        ],
      });
    }

    const start = initial.current;
    const view = new EditorView({ parent: parent.current!, state: stateFor(start.value, start.mode, start.readOnly) });
    editor.current = {
      view, mode: start.mode, readOnly: start.readOnly,
      setSource(value, nextMode, nextReadOnly) {
        const current = editor.current!;
        if (value !== view.state.sliceDoc() && /\r|\n/u.test(value) && markdownLineBreak(value) !== view.state.lineBreak) {
          view.setState(stateFor(value, nextMode, nextReadOnly));
        } else {
          if (value !== view.state.sliceDoc()) updateSource(view, value);
          if (nextMode !== current.mode || nextReadOnly !== current.readOnly) {
            view.dispatch({ effects: [modeConfig.reconfigure(preview(nextMode)), accessConfig.reconfigure(editable(nextReadOnly))] });
          }
        }
        current.mode = nextMode;
        current.readOnly = nextReadOnly;
      },
    };
    return () => {
      editor.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => { editor.current?.setSource(value, mode, readOnly); }, [value, mode, readOnly]);

  return <div className="workspace-markdown-editor" data-mode={mode} ref={parent} />;
}
