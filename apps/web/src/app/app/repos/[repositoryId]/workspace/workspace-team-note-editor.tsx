"use client";

import type { TeamNoteContent } from "@nutshell/core/team-note-content";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { normalizePastedTeamNote } from "./workspace-team-note-paste";

function safeNoteUrl(value: string) {
  if (value.length > 2048 || !/^https?:\/\//iu.test(value) || /[\s\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return Boolean(url.hostname && !url.username && !url.password);
  } catch {
    return false;
  }
}

function extensions(readOnly: boolean) {
  return [
    StarterKit.configure({
      blockquote: false, horizontalRule: false, bold: false, italic: false, code: false,
      underline: false, strike: false, trailingNode: false,
      heading: { levels: [1, 2, 3] },
      link: {
        autolink: false, linkOnPaste: false, openOnClick: readOnly, enableClickSelection: false,
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
        isAllowedUri: safeNoteUrl,
      },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
  ];
}

const blockOptions: { name: string; run: (editor: Editor) => void }[] = [
  { name: "Paragraph", run: (editor) => editor.chain().focus().setParagraph().run() },
  ...([1, 2, 3] as const).map((level) => ({ name: "Heading " + level, run: (editor: Editor) => editor.chain().focus().toggleHeading({ level }).run() })),
  { name: "Bulleted list", run: (editor) => editor.chain().focus().toggleBulletList().run() },
  { name: "Numbered list", run: (editor) => editor.chain().focus().toggleOrderedList().run() },
  { name: "Checklist", run: (editor) => editor.chain().focus().toggleTaskList().run() },
  { name: "Code block", run: (editor) => editor.chain().focus().toggleCodeBlock().run() },
];

function BlockOptions({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [linkInput, setLinkInput] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus();
  }, [open]);

  useEffect(() => {
    if (linkInput) input.current?.focus();
  }, [linkInput]);

  function beginLink() {
    setOpen(false);
    setError("");
    const href: unknown = editor.getAttributes("link").href;
    setUrl(typeof href === "string" ? href : "");
    setLinkInput(true);
  }

  function endLink(restoreFocus: boolean) {
    setLinkInput(false);
    setError("");
    if (restoreFocus) trigger.current?.focus();
  }

  function applyLink() {
    const href = url.trim();
    if (!safeNoteUrl(href)) {
      setError("Enter an HTTP or HTTPS address without credentials.");
      input.current?.focus();
      return;
    }
    const chain = editor.chain().focus();
    if (editor.state.selection.empty && !editor.isActive("link")) {
      chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    } else chain.extendMarkRange("link").setLink({ href }).run();
    endLink(false);
  }

  function menuKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const entries = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='menuitem']"));
    if (!entries.length) return;
    const activeIndex = entries.findIndex((element) => element === document.activeElement);
    if (event.key === "Home") entries[0]?.focus();
    else if (event.key === "End") entries.at(-1)?.focus();
    else entries[(activeIndex + (event.key === "ArrowDown" ? 1 : -1) + entries.length) % entries.length]?.focus();
  }

  return <div className="workspace-note-options" onBlur={(event) => {
    if (open && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      disabled={disabled} onClick={() => setOpen(!open)} onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); }
      }}>
      Block options <ChevronDown aria-hidden="true" size={16} strokeWidth={1.5} />
    </button>
    {open && <div id={menuId} ref={menu} className="workspace-note-block-menu" role="menu" aria-label="Note blocks" onKeyDown={menuKeys}>
      {blockOptions.map(({ name, run }) => (
        <button key={name} type="button" role="menuitem" tabIndex={-1} onClick={() => { setOpen(false); run(editor); }}>{name}</button>
      ))}
      <button type="button" role="menuitem" tabIndex={-1} onClick={beginLink}>Link</button>
    </div>}
    {linkInput && <div className="workspace-note-link" role="group" aria-label="Note link" onKeyDown={(event) => {
      if (event.key === "Escape") { event.stopPropagation(); endLink(true); }
    }}>
      <label><span>Link address</span><input ref={input} type="url" value={url} disabled={disabled} onChange={(event) => setUrl(event.currentTarget.value)}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyLink(); } }} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="workspace-note-actions">
        <button type="button" disabled={disabled} onClick={applyLink}>Apply link</button>
        {editor.isActive("link") && <button type="button" disabled={disabled} onClick={() => {
          editor.chain().focus().extendMarkRange("link").unsetLink().run();
          endLink(false);
        }}>Remove link</button>}
        <button type="button" onClick={() => endLink(true)}>Cancel link</button>
      </div>
    </div>}
  </div>;
}

export function WorkspaceTeamNoteEditor({ content, onChange, disabled = false, label = "Note body" }: {
  content: TeamNoteContent;
  onChange?: (value: TeamNoteContent) => void;
  disabled?: boolean;
  label?: string;
}) {
  const readOnly = !onChange;
  const editor = useEditor({
    extensions: extensions(readOnly),
    content: content.doc,
    immediatelyRender: false,
    editable: !readOnly && !disabled,
    editorProps: {
      attributes: readOnly ? { role: "document", "aria-label": label } : { role: "textbox", "aria-label": label, "aria-multiline": "true" },
      transformPasted: normalizePastedTeamNote,
    },
    onUpdate: ({ editor }) => onChange?.({ schemaVersion: 1, doc: editor.getJSON() as TeamNoteContent["doc"] }),
  }, [readOnly]);

  useEffect(() => {
    if (!editor) return;
    if (!editor.state.doc.eq(editor.schema.nodeFromJSON(content.doc))) {
      editor.commands.setContent(content.doc, { emitUpdate: false, errorOnInvalidContent: true });
    }
    const editable = !readOnly && !disabled;
    if (editor.isEditable !== editable) editor.setEditable(editable, false);
  }, [editor, content, disabled, readOnly]);

  return <div className="workspace-note-body" data-read-only={readOnly}>
    {!readOnly && editor && <BlockOptions editor={editor} disabled={disabled} />}
    <EditorContent editor={editor} />
  </div>;
}
