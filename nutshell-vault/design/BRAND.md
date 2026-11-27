---
id: design-brand
status: active
date: 2026-11-26
tags: [design, brand, assets]
---

# Nutshell Brand Reference

## Context

This active brand guidance preserves the supplied identity for the Nutshell starter and its future application. It is a usage contract, not a claim that application branding has been implemented. The user's original image is the source of truth; [UI_GUIDE.md](UI_GUIDE.md) owns the surrounding visual system.

## Decision

### Name and slogan

- **Product name:** Nutshell
- **Exact slogan:** Your codebase. In a Nutshell.

Keep the slogan's words, capitalization, and both periods. It may wrap visually, but do not rewrite it as “Your code, in a nutshell,” change the casing, or replace it with a generic AI productivity promise. Use **Nutshell** consistently in navigation, authentication, repository pages, document titles, and accessible names.

Nutshell helps people understand and collaborate on AI-assisted GitHub projects through shared repository knowledge, product history, and related team work. Describe those functions concretely. Avoid claims that a generated map is complete, that a repository is secure because it is documented, or that users understand the architecture merely because a graph exists.

### Supplied artwork is the source of truth

The canonical supplied asset in this starter is:

`assets/brand/nutshell-logo.png`

The starter assembly must copy the user's original image byte-for-byte. Do not redraw, trace, regenerate, recolor, sharpen, crop, remove its background, or replace it with a stock walnut, a code-bracket symbol, or a new monogram. The app may scale the image for display while preserving its intrinsic proportions.

The inspected source is **567 × 523 pixels**, with aspect ratio **567:523**. It is an RGBA PNG, but every alpha value in the supplied image is `255`: **the artwork is fully opaque**, with a near-white background. An alpha channel alone does not make it a transparent logo. This observation is about the supplied asset; the starter's copy should be verified against that source during assembly.

The image depicts the supplied open-shell, cloud, code, and connected-node artwork. Use the existing file for that identity. Its subtle violet shading and gradients belong to the original image and are permitted unchanged. They do not authorize gradients or glow effects in the surrounding UI.

### Placement on the dark interface

Treat the image's light background as intentional. Marketing and authentication can place it on a restrained light tile or light logo area with sensible spacing, using a small functional radius where needed. Do not use CSS filters, blend modes, a mask, clipping, or a dark overlay to pretend the source is transparent. Do not stretch it to a square or cut away the shell to fit a slot.

Use `object-fit: contain` or an equivalent intrinsic-ratio treatment. Keep the entire supplied artwork visible. Preserve surrounding space so the shell does not touch nearby text or controls. The logo treatment is an intentional light accent within the dark design, not a reason to turn the entire app into a white-card layout.

The image is detailed. Check it at the actual displayed size instead of assuming that a tiny favicon-size reduction is legible. In a `40px` ribbon, use the unchanged artwork only if the scaled result remains clear. Otherwise, use an ordinary, labeled **Home** navigation control in the ribbon and place the supplied logo with the text **Nutshell** in the expanded navigation/header. A standard Home control is navigation, not a substitute brand mark. Do not invent a new “N” logo or alternate brand identity to fill the small slot.

Use a plain-text Nutshell wordmark when the asset cannot be rendered or cannot fit legibly. This is a textual fallback, not a newly drawn logo. An image-loading failure must not leave an unlabeled or unclickable navigation control.

### Accessible use

When the image is the only content of a home link, give the link a name such as **Nutshell home**. When adjacent visible text already names the brand and link, treat the image as decorative for assistive technology to avoid repeating the same name. Do not pack the slogan into alt text for a logo button.

The unchanged artwork may be used in marketing and authentication at a larger scale. All interactive controls around it still need visible focus and readable labels. Do not assume the image's decorative colors satisfy the contrast requirements of neighboring text or controls.

### Visual language around the brand

Apply the authoritative palette and dimensions in `UI_GUIDE.md`:

- Warm charcoal canvas `#1e1e1e`, recessed `#161616`/`#181818` chrome, and functional luminance steps.
- Violet `#7f6df2`/`#8b5cf6` reserved for the priority elements specified by the user.
- Hairline dividers, small radii, quiet typography, and monochrome Lucide controls.
- No decorative gradient surfaces, glow, oversized pill controls, or generic dashboard-card composition.

The allowed tinted tag treatment remains `rgba(127, 109, 242, 0.15)` with a `4px` radius. Preserve that specific exception rather than applying a blanket ban to every object described as a “pill.”

### Copy and truthful states

Use short, concrete labels: **Vault**, **Memory Graph**, **Product Map**, **History**, **Tasks**, and **Team notes** where those features are present. A Memory Graph shows note relationships; a Product Map shows declared product entities and relationships. Neither label implies a complete dependency graph of the code.

Separate **Saved locally**, **PR pending**, **Indexed**, and deployment states. Label example content **Demo**. Avoid “All synced,” “Up to date,” or success badges without evidence from the actual data flow. Do not use fictional activity, people, repository access, or history to make an empty workspace look established.

### Brand acceptance

- [ ] The asset at `assets/brand/nutshell-logo.png` matches the supplied original byte-for-byte.
- [ ] Its complete artwork and 567:523 aspect ratio are preserved in every use.
- [ ] Its opaque background is intentional; no CSS or image processing disguises it as a cutout.
- [ ] Small-size uses are legible or use the documented text/navigation fallback.
- [ ] Product name and exact slogan are correct.
- [ ] Logo imagery is unchanged, and its existing shading has not spread into gradient UI decoration.
- [ ] Accessible names are useful without duplicate brand announcements.

## Consequences

The opaque source background needs deliberate placement on the dark interface, and the detailed artwork may need the documented text/navigation fallback at very small sizes. Preserve source bytes and proportions. Existing gradients inside the original artwork do not authorize gradient UI surfaces or an alternate identity.

## Affected files

- `assets/brand/nutshell-logo.png` — supplied original, copied unchanged.
- `nutshell-vault/design/BRAND.md` — this brand guidance.
- `nutshell-vault/design/UI_GUIDE.md`, `UI_IMPLEMENTATION.md`, and `UI_ACCEPTANCE.md` — related notes in this directory.
- Future marketing, authentication, and workspace branding in `apps/web/` — planned consumers, not implemented by this note.
