---
id: design-ui-guide
status: active
date: 2026-11-26
tags: [design, ui, source-spec]
source_spec: true
---

# Nutshell UI Guide

## Context

This is the canonical user design specification for the downloadable starter, not evidence of an implemented app. The product is **Nutshell** and its exact slogan is **Your codebase. In a Nutshell.** Read the root [SPEC.md](../../SPEC.md) for product scope and architecture, and [BRAND.md](BRAND.md) for the supplied logo and exact brand wording.

Nutshell should feel like a focused, dark, document-centered workspace: a narrow ribbon, quiet file trees, useful tabs and split panes, readable Markdown, and an interactive graph. Its visual identity is not a generic project dashboard. Preserve the exact numerical values and behaviors in the supplied brief below.

The fifteen bullets below are preserved verbatim. The user's language about eye fatigue describes design intent, not a measured health or medical claim. Supplementary interpretation must not silently replace these directions.

## Decision

### Authoritative user design brief

- Primary Canvas Background: Uses a deep, warm-neutral charcoal (#1e1e1e) rather than pure #000000 black for the main reading and writing area to prevent harsh contrast halation and eye fatigue during long sessions.
- Secondary Chrome & Sidebar Surfaces: Uses a slightly darker recessed charcoal (#161616 or #181818) for the left ribbon, file explorer drawer, and top tab bar so the main editor canvas naturally steps forward without needing drop shadows.
- Elevated & Interactive Surfaces: Uses lighter charcoal steps (#262626 for hover states and inactive tabs, #363636 for active selections and modal inputs) to create clear visual depth purely through luminance shifts.
- Signature Violet-Purple Accent: Restricts vibrant violet (#7f6df2 / #8b5cf6) strictly to high-priority elements—primary marketing CTA buttons, active wikilinks ([[Note]]), cursor carets, focus rings, and highlighted graph nodes—while pairing it with a 15% opacity purple tint (rgba(127, 109, 242, 0.15)) for tag pills and active selections.
- Hairline 1px Structural Borders: Replaces thick cards, gradients, and heavy drop shadows with sharp 1px solid borders (#2e2e2e or #333333) to divide sidebars, split panes, tables, and modal containers.
- Tight, Functional Border Radii: Applies small, utilitarian corner rounding—4px on buttons, inputs, and tags; 6px on dropdown menus and cards; and 8px to 12px on centered modals and marketing app preview frames.
- Three-Zone App Shell Architecture: Organizes the workspace into an ultra-narrow 40px vertical icon ribbon on the far left, collapsible dockable sidebars on the left and right edges, and an infinitely splittable central pane area with browser-style tabs.
- Minimalist Marketing Hero Composition: Pairs a single-row translucent top navigation bar with a high-contrast white headline (48px–64px, tight -0.03em tracking), a muted gray subtitle (#999999), one solid purple CTA button, and an oversized, edge-cropped interactive app preview showing the editor alongside the node graph.
- Two-Tier Typography System: Uses crisp system sans-serif fonts (Inter, -apple-system, Segoe UI) at 12px–13px for quiet UI chrome and file trees, while rendering document body copy at 16px with generous 1.6 line-height and 700px max readable line length.
- Inline Monospace & Syntax Styling: Renders code blocks, YAML frontmatter properties, and inline tags in a high-legibility monospace font (JetBrains Mono or Fira Code) set inside subtly recessed #181818 containers with 1px borders.
- Live Preview Markdown Rendering: Hides raw Markdown formatting tokens (**, ##, [[, ]]) in the active editor until the user's text cursor moves onto that exact line, preserving plain-text editing speed while maintaining a clean reading view.
- Uniform Monochrome Line Icons: Uses consistent 1.5px-stroke outline icons (Lucide icon set) sized at 16px–18px in muted gray (#8e8e8e), transitioning to bright off-white (#dcddde) only on hover or when toggled active.
- Keyboard-First Command Palette: Replaces cluttered top formatting toolbars with a centered 560px-wide floating modal (Cmd/Ctrl + P) featuring an instant fuzzy-search input, keyboard shortcut badges on the right, and subtle #2a2a2a row highlights.
- Interactive Node Graph & Canvas Centerpiece: Visualizes note connections using thin 1px vector edges (#3a3a3a), circular nodes that illuminate in #7f6df2 on hover while dimming unrelated nodes to 20% opacity, and smooth physics-based pan and zoom controls.
- Muted Status Bar & Metadata Chrome: Anchors a slim 24px-tall footer bar along the bottom edge displaying low-contrast 11px counters for backlinks, word count, character count, and sync status without pulling attention away from the center pane.

### Baseline tokens and component interpretation

Use the supplied values literally. Do not replace them with a framework's approximate gray or purple scale. `TOKENS.css` is the reference inventory; the application may expose them through its chosen styling system.

| Element or state | Baseline rule |
| --- | --- |
| Main reading/writing canvas | `#1e1e1e` |
| Ribbon and recessed sidebars | `#161616`; `#181818` is the permitted secondary chrome surface |
| Tab-bar background and code backing | `#181818` |
| Inactive tabs and hover surfaces | `#262626` |
| Active selections and modal inputs | `#363636`; use the specified violet tint as the additional active-selection treatment where relevant |
| Accent | `#7f6df2` primary; `#8b5cf6` permitted alternate, used only for the priority elements named in the brief |
| Accent tint | `rgba(127, 109, 242, 0.15)`; retain 15% alpha |
| Structural borders | `1px solid #2e2e2e` or `#333333` |
| Command-palette highlighted row | `#2a2a2a` |
| Default graph edges | `1px`, `#3a3a3a` |
| Ordinary readable foreground | Implementation default `#dcddde`; marketing headline `#ffffff` |
| Subtitle and quiet metadata | `#999999` on the dark baseline surface; avoid using it indiscriminately on lighter input/selection fills |
| Icon foreground | `#8e8e8e`, becoming `#dcddde` on hover or active toggle |
| Button, input, and tag radius | `4px` |
| Dropdown and card radius | `6px` |
| Modal and marketing-preview radius | `8px–12px`; proposed default `10px` for dialogs, `12px` for the preview |

**Resolve the apparent “pill” and “card” tension precisely.** The brief explicitly permits tinted tag pills, but also specifies their `4px` radius. Implement compact, gently rounded rectangular tags, not capsule-shaped navigation or buttons. A `6px` card radius is available when a card is functionally necessary; it is not a reason to turn the workspace into a grid of summary cards.

Use luminance, spacing, alignment, and hairlines to establish hierarchy. Avoid gradient UI fills, decorative glows, oversized rounded containers, heavy shadows, glass-card dashboards, ornamental status badges, and random purple ornament. The supplied logo's existing artwork is the sole relevant gradient exception; see `BRAND.md`.

The translucent marketing navigation may use a uniform charcoal alpha fill. Translucency is not permission to add a gradient, glowing backdrop, or frosted-card system. Keep the underlying composition simple enough that its text remains legible.

### Retrieve the relevant supplement

- For marketing, panes, editor behavior, graph semantics, commands, or status, read the relevant section of [UI_IMPLEMENTATION.md](UI_IMPLEMENTATION.md).
- For contrast observations, test criteria, or screenshot evidence, read the relevant section of [UI_ACCEPTANCE.md](UI_ACCEPTANCE.md).
- [TOKENS.css](TOKENS.css) contains reference variables only; it is not a built application.

## Consequences

Exact visual fidelity is required. The detailed interaction guidance preserves source editing, truthful states, keyboard access, reduced motion, and separate memory/product graph meanings. Some baseline colors have documented contrast limitations; report them honestly and keep any high-contrast alternative an explicit user preference. Do not claim implementation or verification from this planning note.

## Affected files

- `nutshell-vault/design/UI_GUIDE.md` — canonical user requirements and interpretation.
- `nutshell-vault/design/UI_IMPLEMENTATION.md` — scoped interaction guidance.
- `nutshell-vault/design/UI_ACCEPTANCE.md` — contrast notes and future verification.
- `nutshell-vault/design/BRAND.md` and `nutshell-vault/design/TOKENS.css` — brand and reference tokens.
- `SPEC.md` and future `apps/web/` implementation — apply this contract; this note creates no product code.
