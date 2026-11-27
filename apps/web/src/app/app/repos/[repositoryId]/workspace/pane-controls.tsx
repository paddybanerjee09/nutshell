"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ButtonHTMLAttributes, KeyboardEvent, PointerEvent, RefObject } from "react";
import { Ellipsis, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type WorkspaceCommand = { id: string; label: string; detail?: string; shortcut?: string; run: () => void };

export function IconButton({ icon: Icon, label, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
}) {
  return (
    <button type="button" className={["workspace-icon-button", className].filter(Boolean).join(" ")} aria-label={label} title={label} {...props}>
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
    </button>
  );
}

export function PaneMenu({ commands }: { commands: WorkspaceCommand[] }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);

  return (
    <details
      className="workspace-pane-menu"
      ref={menu}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !menu.current?.open) return;
        event.stopPropagation();
        menu.current.open = false;
        summary.current?.focus();
      }}
    >
      <summary className="workspace-icon-button" ref={summary} aria-label="Pane actions" title="Pane actions">
        <Ellipsis size={16} strokeWidth={1.5} aria-hidden="true" />
      </summary>
      <div className="workspace-menu">
        {commands.map(({ id, label, run }) => (
          <button key={id} type="button" onClick={() => {
            if (menu.current) menu.current.open = false;
            summary.current?.focus();
            run();
          }}>{label}</button>
        ))}
      </div>
    </details>
  );
}

export function ResizeHandle({ id, axis, label, value, min, max, side, onResize, onPointerResize }: {
  id?: string;
  axis: "horizontal" | "vertical";
  label: string;
  value: number;
  min: number;
  max: number;
  side?: "left" | "right";
  onResize: (value: number) => void;
  onPointerResize: (event: PointerEvent<HTMLDivElement>, bounds: DOMRect) => void;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const smaller = axis === "horizontal" ? "ArrowLeft" : "ArrowUp";
    const larger = axis === "horizontal" ? "ArrowRight" : "ArrowDown";
    if (![smaller, larger, "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const step = side ? 12 : 5;
    let next = event.key === "Home" ? min : event.key === "End" ? max
      : value + (event.key === larger ? 1 : -1) * (side === "right" ? -step : step);
    next = Math.min(max, Math.max(min, next));
    onResize(next);
  }

  return (
    <div
      id={id}
      role="separator"
      tabIndex={0}
      className={side ? "workspace-sidebar-resizer" : "workspace-divider"}
      data-axis={axis}
      data-side={side}
      aria-label={label}
      aria-orientation={axis === "horizontal" ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const handle = event.currentTarget;
        if (!handle.hasPointerCapture(event.pointerId) || !handle.parentElement) return;
        onPointerResize(event, handle.parentElement.getBoundingClientRect());
      }}
    />
  );
}

function matchScore(label: string, query: string) {
  const direct = label.indexOf(query);
  if (direct >= 0) return direct;
  let previous = -1;
  for (const character of query) {
    previous = label.indexOf(character, previous + 1);
    if (previous < 0) return Number.POSITIVE_INFINITY;
  }
  return 1_000 + previous;
}

export function CommandPalette({ dialog, commands, onClose }: {
  dialog: RefObject<HTMLDialogElement | null>;
  commands: WorkspaceCommand[];
  onClose: (restoreFocus: boolean) => void;
}) {
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);
  const invokedCommand = useRef(false);
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState(0);
  const needle = query.trim().toLowerCase();
  const results = commands
    .map((command) => ({ command, score: matchScore((command.label + " " + (command.detail ?? "")).toLowerCase(), needle) }))
    .filter(({ score }) => Number.isFinite(score))
    .sort((left, right) => left.score - right.score)
    .slice(0, 50)
    .map(({ command }) => command);
  const selected = Math.min(selection, results.length - 1);

  useEffect(() => {
    list.current?.children[selected]?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function run(command: WorkspaceCommand) {
    invokedCommand.current = true;
    dialog.current?.close();
    command.run();
  }

  return (
    <dialog className="workspace-palette" ref={dialog} aria-label="Command palette" onClose={() => {
      setQuery("");
      setSelection(0);
      onClose(!invokedCommand.current);
      invokedCommand.current = false;
    }}>
      <form onSubmit={(event) => {
        event.preventDefault();
        const command = results[selected];
        if (command) run(command);
      }}>
        <div className="workspace-palette-input">
          <Search size={16} strokeWidth={1.5} aria-hidden="true" />
          <input
            className="workspace-palette-search"
            type="search"
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-label="Search commands and files"
            aria-controls={listId}
            aria-activedescendant={selected >= 0 ? listId + "-" + selected : undefined}
            placeholder="Search commands and files"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setSelection(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                dialog.current?.close();
                return;
              }
              if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
              event.preventDefault();
              if (results.length) setSelection((selected + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
            }}
          />
        </div>
      </form>
      <ul id={listId} role="listbox" aria-label="Search results" ref={list} className="workspace-palette-results">
        {results.map((command, index) => (
          <li
            key={command.id}
            id={listId + "-" + index}
            role="option"
            aria-selected={index === selected}
            className="workspace-palette-result"
            onClick={() => run(command)}
          >
            <span className="workspace-palette-label">{command.label}{command.detail && <small>{command.detail}</small>}</span>
            {command.shortcut && <kbd>{command.shortcut}</kbd>}
          </li>
        ))}
      </ul>
      {!results.length && <p className="workspace-palette-empty" role="status">No matching commands or files.</p>}
    </dialog>
  );
}
