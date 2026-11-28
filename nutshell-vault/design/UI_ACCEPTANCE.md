---
id: design-ui-acceptance
status: active
date: 2026-11-26
tags: [design, ui, qa, contrast, accessibility]
---

# Nutshell UI Acceptance Guidance

## Context

This active guidance supports the canonical [UI_GUIDE.md](UI_GUIDE.md) and scoped [UI_IMPLEMENTATION.md](UI_IMPLEMENTATION.md). It records calculated contrast observations and future verification criteria. No application check or screenshot is claimed complete in this starter.

## Decision

### Measured contrast notes and explicit alternatives

These are **QA observations**, not a claim that the baseline meets WCAG AA and not a new approval gate blocking the first build. Ratios below use the WCAG relative-luminance calculation for opaque sRGB pairs and are rounded for reporting; verify actual rendered combinations, opacity, and compositing. Do not silently substitute a new accent hue to improve a score.

| Foreground / background | Approximate ratio | Consequence |
| --- | --- | --- |
| `#dcddde` / `#1e1e1e` | `12.26:1` | Suitable high-contrast ordinary foreground |
| `#999999` / `#1e1e1e` | `5.85:1` | Subtitle/quiet text has adequate contrast against the main canvas |
| `#8e8e8e` / `#1e1e1e` | `5.09:1` | Requested muted icon color remains distinguishable on the canvas |
| `#999999` / `#363636` | `4.24:1` | Do not assume the same muted text is adequate in selected/input states |
| `#7f6df2` / `#1e1e1e` | `4.26:1` | Violet normal-size wikilink text falls below the usual `4.5:1` text threshold |
| `#8b5cf6` / `#1e1e1e` | `3.94:1` | The alternate violet also falls below that normal-text threshold |
| `#ffffff` / `#7f6df2` | `3.91:1` | White is not the chosen baseline small CTA-label color |
| `#161616` / `#7f6df2` | `4.63:1` | Chosen dark CTA label preserves supplied colors and clears `4.5:1` |
| `#3a3a3a` / `#1e1e1e` | `1.47:1` | Requested graph edges are low contrast when they communicate essential relationships |
| `#2e2e2e` / `#1e1e1e` | `1.23:1` | Structural hairlines are decorative separation, not a sufficient sole control/focus cue |

For reference, WCAG's normal-text criterion generally uses `4.5:1`, and meaningful non-text graphics/control cues generally use `3:1`, subject to the criterion's scope and exceptions. An underline helps identify a link but **does not repair inadequate text contrast**. Increasing the thickness of a low-contrast edge likewise does not change its color ratio.

Preserve violet active wikilinks on the default canvas as requested, and record the limitation in QA. An optional, explicitly selected high-contrast mode may, for example, put `#7f6df2` link text on a recessed `#181818` backing (approximately `4.54:1`) or use a separately reviewed accessible token set. Similarly, a labeled high-contrast graph mode may use a more visible edge color and remove dimming. These alternatives must not overwrite the default silently.

Keyboard operation, visible focus, useful names, readable errors, and reduced-motion support are baseline implementation requirements independent of any visual-conformance claim. Retain decorative hairlines while giving essential controls sufficient identifying content and clear focus. Audit actual controls rather than declaring the whole palette “accessible.”

Primary references: [W3C text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [W3C non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), and [W3C target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Ratios are calculations from the supplied colors, not measurements of an already built application.

### Implementation acceptance checklist

Record pass/fail and concrete evidence after implementation. These are future checks; no box is pre-completed in this starter.

#### Visual fidelity

- [ ] Main canvas, chrome, hover, selected/input, accent/tint, border, graph-edge, palette-row, subtitle, and icon values match the authoritative user brief in `UI_GUIDE.md` exactly in the baseline.
- [ ] The ribbon measures `40px`; the status bar `24px`; the desktop palette `560px`; text sizes, line-height, readable width, icon stroke/size, and radii match the brief.
- [ ] No generic dashboard card grid, capsule navigation, gradient UI, glow, thick borders, or heavy shadows have replaced the requested workspace language.
- [ ] Tinted tags retain `15%` violet alpha and `4px` corners. Where a card is needed, it uses the permitted `6px` radius without redefining the layout.
- [ ] Marketing has a single-row translucent navigation, `48px–64px` white headline with `-0.03em` tracking, `#999999` subtitle, one solid-purple primary CTA, and an oversized interactive editor-plus-graph preview.
- [ ] The supplied logo is unchanged and legible, its aspect ratio preserved, its opaque background treated intentionally, and the exact slogan appears correctly.

#### Layout and real interactions

- [ ] Both sidebars collapse and dock; recursive splits work horizontally and vertically beyond a fixed two-pane layout when the viewport can fit them.
- [ ] Splitting below the minimum usable size leaves the document available as a tab and explains the limit; resizing/restoring never loses work or places controls offscreen.
- [ ] Tab activation, closing, moving, and focus restoration work with keyboard and pointer. Unsaved buffers survive layout changes.
- [ ] The command palette searches, invokes real commands, shows right-aligned shortcut badges, uses `#2a2a2a` row highlights, and closes with focus restoration.
- [ ] Memory Graph and Product Map identify their data sources and relationship meanings; no layout proximity or note link is presented as an inferred code dependency.
- [ ] Graph nodes are circular; default edges are `1px #3a3a3a`; hover highlights use `#7f6df2`; unrelated nodes become exactly `20%` opaque in the baseline.
- [ ] Pan/zoom, fit/reset, pause, keyboard/list navigation, and touch inspection work; reduced motion produces a stable, non-animated view.
- [ ] Marketing-preview interactions are real and fixture data is labeled. Preview actions cannot modify a real repository.

#### Editor and data integrity

- [ ] Live preview hides only presentation tokens on non-cursor lines and reveals them on the exact cursor line; Source and Read modes remain available.
- [ ] Selection across decorated syntax, multiple cursors, clipboard operations, undo/redo, IME composition, combining marks, and emoji preserve the actual source.
- [ ] Opening, scrolling, and moving the cursor do not rewrite Markdown or create undo history. Frontmatter, fences, escaped tokens, incomplete syntax, and whitespace survive.
- [ ] Raw HTML/MDX, unsafe URLs, malicious labels, and unauthorized image references cannot execute or silently fetch arbitrary content.
- [ ] Save, conflict, offline, PR, indexing, and demo states are truthful; counters derive from content rather than seeded numbers.

#### Screenshots and access checks

- [ ] Capture desktop marketing and workspace views at `1440×900` and `1280×800`, including editor-plus-graph, open docks, and a recursive split.
- [ ] Capture tablet behavior at `1024×768` and `768×1024`, including dock overlays and the palette.
- [ ] Capture mobile behavior at `390×844` and `320×740`, including source editing, graph navigation, and the open menu/palette. The functional app has no accidental horizontal page overflow.
- [ ] Capture hover, active selection, focus, empty, loading, error/offline, and selected-graph-node states; record intentional marketing-edge cropping separately.
- [ ] Complete a keyboard-only path through navigation, a note, the palette, a split, the graph/list mode, and a dialog; no focus trap or pointer-only dependency remains.
- [ ] Check zoom/reflow, screen-reader labels and status announcements, and reduced-motion behavior. Glyph size is not mistaken for click-target size.
- [ ] Record contrast findings from the real rendered UI without claiming baseline AA compliance. If an optional high-contrast mode exists, test and label it separately.

Keep screenshots and implementation evidence in the destination prescribed by `SPEC.md`. Do not fabricate screenshots or mark behavior complete before the running application demonstrates it.

### Observed Windows browser evidence

Firefox checked the running app at six viewport sizes and checked a 720×450 reflow viewport. Chrome's native 200% control halved the CSS viewport from 1422 to 711 pixels and doubled device pixel ratio on an isolated test document. A DevTools composition probe preserved Japanese characters, a combining mark, and emoji. Windows paging exhaustion stopped the concurrent browser and app journey before it could confirm native zoom or CodeMirror composition in Nutshell. Keyboard IME and in-app native zoom are still open. [Acceptance ledger](../runs/ACCEPTANCE.md) and [DevTools input protocol](https://chromedevtools.github.io/devtools-protocol/tot/Input/).

## Consequences

The default palette remains exactly as requested; documented contrast tensions are not silently “fixed” by a redesign and are not a new approval gate. Report failed, blocked, and unrun checks honestly. A screenshot baseline or an automated score alone does not prove visual fidelity, correct editing behavior, or accessibility.

## Affected files

- `nutshell-vault/design/UI_GUIDE.md` — canonical values and behaviors checked here.
- `nutshell-vault/design/UI_IMPLEMENTATION.md` — interaction rules checked here.
- `nutshell-vault/design/UI_ACCEPTANCE.md` — this verification guidance.
- `nutshell-vault/design/BRAND.md` and `nutshell-vault/design/TOKENS.css` — related design references; root `SPEC.md` owns delivery requirements.
- Future UI tests and screenshot evidence — use the destinations prescribed by `SPEC.md`; no evidence is fabricated here.
