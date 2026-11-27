---
id: design-ui-implementation
status: active
date: 2026-11-26
tags: [design, ui, interaction, markdown, accessibility]
---

# Nutshell UI Implementation Guidance

## Context

This active guidance interprets [UI_GUIDE.md](UI_GUIDE.md), which owns the user's exact fifteen visual requirements. Read only the sections relevant to the current UI task. It describes future behavior, not completed implementation. [SPEC.md](../../SPEC.md) owns architecture, authorization, and build scope.

## Decision

### Marketing and entry experience

Use the brand name **Nutshell** and the exact slogan **Your codebase. In a Nutshell.** Preserve its capitalization and punctuation; visual line breaks may change without changing the words.

The first viewport contains a single-row navigation, the `48px–64px` white headline with `-0.03em` tracking, a `#999999` subtitle, one solid-purple primary CTA, and the oversized app preview. The headline may wrap on narrow screens; do not shrink it into unrelated small dashboard typography. Keep secondary navigation quiet rather than introducing a second competing primary CTA.

Use `#7f6df2` for the baseline solid CTA and `#161616` for its label. This preserves the specified palette and provides more text contrast than white on that purple. Buttons remain `4px` rounded. The logo must use the supplied file, not a newly drawn walnut or generic code icon.

The preview must show an editor and a node graph together at a useful desktop scale. Crop its outer edges deliberately within a bounded marketing region; do not cause document-level horizontal scrolling. The functional application itself must fit its viewport and must not inherit this marketing crop.

“Interactive preview” means working interactions, not a screenshot with a hover effect. A fixture-backed preview can support tab changes, note selection, graph inspection, and pan/zoom using the same visual components as the workspace. Label fixture content **Demo**. Preview edits must be isolated from real repositories. Provide a way to open or focus the full preview so cropped controls are not the only path to an action. Pause any ongoing motion when the preview is outside the viewport.

On mobile, keep navigation on one row using a compact menu for secondary links. Keep the headline, subtitle, CTA, and preview in the same hierarchy. The preview may retain a wide illustrative crop, but keyboard users must be able to enter a usable uncropped view and leave it predictably.

### Workspace shell and recursive panes

#### Zones and content

1. **Left ribbon:** exactly `40px` wide in the baseline. Use the specified Lucide outline icons. Each action has an accessible name, a visible hover/focus explanation, and a usable hit area larger than its `16px–18px` artwork.
2. **Dockable sidebars:** independently collapsible on the left and right. The left starts with repository/vault navigation and a file tree. The right can host backlinks, outline, properties, or contextual details. Contents can move between supported docks without changing the document's identity. Use hairline separators, not floating cards.
3. **Central panes:** browser-style tab groups inside a recursive split layout. A pane can contain a document, graph, product record, task view, or team note. The content type is apparent from its title and icon.

The bottom status bar spans the workspace's bottom edge and is `24px` tall at the baseline zoom level. Sidebars, panes, and tab groups must size within the remaining height rather than pushing the status bar offscreen.

#### Split behavior and finite resources

Interpret “infinitely splittable” as **recursive layout capability with no artificial two-pane-only model**. It cannot promise infinite screen space, memory, browser resources, or simultaneously rendered editors.

Represent layouts as a tree: a split has an orientation and child layouts; a leaf has an ordered tab set and active tab. Support horizontal and vertical splitting, moving tabs between leaves, closing panes, resizing, collapsing docks, and restoring a saved layout. A suggested implementation is a recursive wrapper around the split-pane library chosen in `SPEC.md`; library selection must not flatten the model into a fixed three-column mockup.

Implementation starting points are a `280px` minimum leaf width and `180px` minimum leaf height. These are **proposed usability defaults**, not values supplied by the user. Measure the real chrome and revise them if necessary. A split command must check the available rectangle. If it cannot fit both children, keep the content as a tab and explain that the viewport is too small for another visible split. Do not create negative widths, offscreen resize handles, or a page-wide horizontal scroll region.

Restore layouts defensively after a window resize or device change. Preserve tab order and unsaved work while temporarily consolidating panes. Closing a pane should move or close its tabs according to a clear command, with protection for unsaved changes. Do not silently discard a document merely because a sidebar was expanded.

Inactive tabs and offscreen views can suspend expensive rendering while retaining their actual document state. A resource cap, if needed, must be explicit and recoverable rather than an unexplained blank pane. One document opened in multiple panes shares the underlying source state; editing in one must not overwrite a divergent hidden copy.

#### Keyboard and responsive behavior

Every drag interaction needs a keyboard command: split right/down, move tab to another pane, move panel to another dock, resize the current split, collapse sidebar, focus next pane, and return to editor. Separators must expose orientation and current value when adjustable by keyboard. Tab activation, closing, and focus must be distinct actions with reliable focus return.

At narrower desktop widths, collapse a dock before crushing the editor. At tablet widths, allow docks to open as bounded overlays with a close control and focus return. On mobile, present one central leaf at a time, with tabs and pane selection preserving the underlying layout. The ribbon remains the same narrow navigation language; do not replace the app with an unrelated card dashboard. Mobile graph and editor views can be separate tabs even though the desktop marketing preview shows them side by side.

### Markdown source and live preview

#### A source editor with decorations

The vault editor operates on the original Markdown text. Use **CodeMirror 6** for source editing and decorations, subject to `SPEC.md`. The rendered appearance must be a view over that source. Do not convert the vault into a full WYSIWYG document model, serialize it through a rich-text editor, or rewrite formatting merely because a document was opened.

In live preview, hide Markdown formatting tokens such as `**`, `##`, `[[`, and `]]` on lines without the text cursor. When the cursor moves onto a line, reveal that line's source tokens. Use parser-aware decorations rather than global regular-expression replacement. Moving the cursor changes decoration state only; it must not edit the document or create an undo entry. Render active wikilinks in the specified violet. Preserve their source targets and any display aliases.

Provide explicit **Live preview**, **Source**, and **Read** controls through a quiet pane menu or the command palette. Source mode reveals all syntax. Read mode does not pretend to be an editable input. These modes are useful fallbacks, not substitutes for implementing the requested live preview.

Body text is `16px`, line height `1.6`, and no wider than `700px` in a readable document column. The surrounding canvas can be wider. Use horizontal scrolling or deliberate wrapping within code blocks rather than widening the entire page. Code, YAML frontmatter properties, and inline tags use JetBrains Mono or Fira Code with suitable monospace fallbacks, recessed `#181818` backing, and `1px` borders.

#### Editing correctness

- Keep selection offsets, cursor placement, copy/paste, undo/redo, and saved bytes faithful to the source, including when syntax decorations are hidden.
- For multiple cursors, reveal syntax on each cursor's exact line. A range selection must remain understandable and selectable; source mode is always available without changing the text.
- Do not recompute or replace decorations in a way that cancels an active IME composition. Test composing Chinese or Japanese text, dead keys, emoji, and combining marks.
- Verify clicking around hidden tokens, navigating across a heading boundary, deleting a wikilink delimiter, extending a selection across decorated lines, and undoing those edits.
- Preserve fenced code, escaped syntax, incomplete Markdown, YAML ordering, and intentionally unusual whitespace. Preview must remain usable while a source construct is temporarily incomplete.
- External updates must produce a visible revision/conflict decision when local edits exist; they must not overwrite the active buffer silently.

#### Content is untrusted

Repository Markdown, note titles, link labels, frontmatter, and graph labels are data. They must not execute scripts, raw HTML, MDX, arbitrary embedded code, or JavaScript URLs. Handle links and image references according to the repository/media security policy in `SPEC.md`. Do not fetch arbitrary external images merely to make a preview look complete. Clearly label unavailable or unauthorized content.

If structured team notes or task blocks use Tiptap or another rich-text editor, that is a separate content surface with its own declared storage format. Match the same visual language, but do not use it to round-trip canonical vault Markdown.

### Graphs: memory connections and product structure

#### Keep the two meanings distinct

| View | Nodes and edges mean | Must not imply |
| --- | --- | --- |
| **Memory Graph** | Vault notes and resolved note links, including supported `[[wikilinks]]`; backlink counts derive from those links | Code dependencies, deployment state, or the complete system architecture |
| **Product Map** | Validated product entities such as features or screens, with explicitly declared typed relationships from the product records | That a note link, file proximity, visual cluster, or force-layout position proves a code dependency |

The two views may share a renderer and controls. Their labels, legends, filters, empty states, provenance, and selected-node details must say which dataset is being shown. A product relationship remains its declared type; do not turn every edge into an unlabeled “depends on.” Use stable record identifiers and repository revisions supplied by the data layer.

#### Requested visual and interaction behavior

Use circular nodes, default `1px` vector edges in `#3a3a3a`, and `#7f6df2` for the hovered node. Dim unrelated nodes to exactly `20%` opacity while the relevant hover/focus/selection context is active. Restore them when it ends. Selection by keyboard and deliberate tap must expose the same relationship context as hover; a touch user cannot depend on hover alone.

Support smooth pan and zoom with a physics-based layout. A force simulation arranges the display; it never creates or changes semantic relationships. Let the layout settle, allow the user to pause or reset it, and avoid endless jitter. A shared graph renderer using `@xyflow/react` with `d3-force` can implement the rendering/layout split if that remains the choice in `SPEC.md`.

Include visible controls for zoom in, zoom out, fit, reset, and pause/resume layout, with accessible names. Make selecting a node distinct from dragging it. Keep details and provenance in a pane or dock so hovering is not the only way to read a node. Persist a dragged display position only as a view preference unless the product explicitly defines another meaning.

Large graphs require a bounded query or focused neighborhood, not unbounded rendering of every historical record. State the visible scope and whether filters are active. Never label a partial graph “the entire architecture.”

#### Accessible navigation and graphics modes

Provide a **list/outline navigation view** of the current nodes and relationships that supports search, keyboard selection, and opening the same details. Canvas exploration should be an explicit interaction mode with predictable focus and an obvious exit. Do not capture all arrow keys while the user is typing in another pane. A navigable list is an alternative route to the information; it does not by itself make low-contrast graphics conformant.

Support reduced motion: stop ongoing physics animation, remove animated camera travel, and show a stable layout with instant, controllable navigation. Honor `prefers-reduced-motion` and expose a pause control. Optional high-contrast graphics may strengthen edge colors and disable unrelated-node dimming, but must be a deliberate, labeled user preference. Preserve the user's exact palette and `20%` dimming in the baseline.

### Commands, controls, and status

#### Command palette

Open the palette with **Cmd + P** on macOS and **Ctrl + P** on other supported desktop platforms. Handle the shortcut while the Nutshell workspace is active; do not intercept it in an unrelated browser page. Expose a visible entry point as well.

The centered floating dialog is `560px` wide when space allows, with an `8px–12px` radius. On small viewports, constrain it to the viewport with comfortable outer margins. Give the search input focus, display fuzzy matches immediately, use `#2a2a2a` for the highlighted row, and align shortcut badges on the right. Use the specified `#363636` modal-input fill.

Arrow keys move the active result, Enter invokes it, and Escape closes the dialog and restores the previous focus. Give the result list and active result proper accessible semantics. Commands for unavailable capabilities remain truthfully unavailable with an explanation; they must not appear to complete by changing a visual label only.

Keep formatting commands here and in a minimal context menu rather than adding a permanently crowded formatting toolbar above every document.

#### Icons and hit areas

Use Lucide outline icons with `1.5px` stroke and `16px–18px` visible size throughout. Preserve the muted-to-off-white state change. Icon-only controls need accessible labels and keyboard-visible focus; a tooltip alone is not their accessible name. The hit area can be larger than the glyph. A proposed desktop minimum is `32px` square where space permits, and touch targets should be more generous without changing the glyph style.

#### Truthful metadata

The status bar is `24px` high and uses `11px` counters for backlinks, words, characters, and sync status. Counts refer to the active document and must come from actual content using a consistent documented algorithm. Backlinks must identify whether they reflect the current local view or an indexed repository revision. Avoid placeholder numbers presented as live facts.

Use explicit state labels such as **Local draft**, **Saving**, **Saved locally**, **PR pending**, **Indexed**, **Offline**, **Error**, or **Demo** as appropriate to the real data flow. A local save is not a GitHub merge; an indexed merge is not a deployment. Show the relevant repository, branch/revision, and update time in details. Do not show “Synced” or a success indicator until the underlying operation has succeeded and the relevant revision is known.

On narrow screens, prioritize the active state and provide the remaining counters in a keyboard-accessible details control. Do not shrink the required counters further or place an error message outside the viewport. Announce meaningful failures and completed saves accessibly without announcing every keystroke or counter update.

## Consequences

The shell, editor, and graphs must remain functional under resizing, keyboard use, untrusted content, and finite browser resources. Supplementary defaults are labeled as proposals and must not replace the canonical palette, typography, or user-specified behavior. Keep simulated preview data and actual repository states visibly distinct.

Verify the affected behavior using [UI_ACCEPTANCE.md](UI_ACCEPTANCE.md); preserve the supplied artwork according to [BRAND.md](BRAND.md). Record actual implementation decisions and evidence when the app exists.

## Affected files

- `nutshell-vault/design/UI_GUIDE.md` — authoritative visual requirements.
- `nutshell-vault/design/UI_IMPLEMENTATION.md` — this interaction guidance.
- `nutshell-vault/design/UI_ACCEPTANCE.md`, `BRAND.md`, and `TOKENS.css` — verification and related design references in this directory.
- Future `apps/web/` UI components and tests — planned implementation targets, not files created by this note.
