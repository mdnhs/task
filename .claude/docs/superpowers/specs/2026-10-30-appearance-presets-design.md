# Workspace appearance presets (design)

Date: 2026-10-30 · Extends FR-SAAS-11 (tenant branding)

## Why

OpsDesk is multi-tenant. Each client company has its own brand, and today an admin can only change the name, logo and
brand colour. Admins want the whole app to feel like their brand: how rounded things are, how big the text is, how
airy or dense the layout is.

## What

In **Settings → Branding**, under the brand colour, an **Appearance** section with three settings. Each setting has
three ready-made options (no sliders). The middle option is today's look, so nothing changes until an admin picks.

| Setting | Options | What it changes |
|---|---|---|
| Corners | Sharp · **Soft** · Round | every radius: cards, buttons, pills, inputs, popups, badges, chart tooltips |
| Text size | Small · **Default** · Large | every text size across the app, in proportion |
| Spacing | Compact · **Comfortable** · Spacious | space inside cards **and** the layout: page padding, sidebar, topbar, gaps between cards, sections and grid rows |

- **Who:** the workspace admin (anyone with settings write access, same rule as `saveBranding`). It applies to every
  user of that tenant. Users cannot override it.
- **Preview:** picking an option previews it live across the app (same pattern as the brand colour). Save applies it
  for everyone; leaving without saving restores the saved look. A "Reset to default" puts all three back to the middle.

## Goals

- One choice changes the look everywhere, light and dark mode, desktop and phone.
- Loading skeletons follow the same settings, so loading → content does not jump (architecture.md → Skeletons).
- Stays within safe limits: no option can make the app unusable.

## Non-goals

- Per-user preferences (that is a separate feature if ever wanted).
- Free sliders or custom pixel values.
- Font family choice (out of scope for now).
- Changing the status colours or the brand colour logic.

## Anti-goals (would count as a failure even if it "works")

- Layout breaking at any combination (overlapping text, clipped cards, horizontal scroll on phones).
- Skeletons no longer matching the loaded page.
- A first paint in the default look that then flashes into the tenant's look.

## Constraints

- Tokens only (ui-rules.md): new CSS custom properties on `:root`, set by the server like `brandCss`, so the first
  paint is already right.
- Persist like branding today: the per-tenant `od-brand-<tenantId>` cookie gets an `appearance` object; `withBranding`
  reads it; `app/(app)/layout.tsx` emits it in the same `<style id="od-brand">`.
- Never hard-code tenant values.

## How (decided)

- Three scale tokens on `:root`: `--radius-scale`, `--text-scale`, `--space-scale` (1 = today).
  - Option values (my call, tuned in the browser): Corners 0.4 / 1 / 1.4 (pills stay pills);
    Text 0.92 / 1 / 1.1; Spacing 0.75 / 1 / 1.3.
- **Corners:** the existing `--r-xl/lg/md` tokens become `calc(base * var(--radius-scale))`; the 76 hard-coded px radii
  are converted the same way (one mechanical pass). `--r-pill` stays 999px.
- **Spacing:** the layout-level paddings and gaps become `calc(base * var(--space-scale))`: body/page padding, sidebar,
  topbar, `.main`, `.canvas` stack gap, `.card` padding, `.card-head` margin, `.stats`/`.grid-2`/`.grid-3` gaps and the
  per-feature grids that sit at that level. Small internal paddings (badges, pills, table cells) stay fixed.
- **Text size:** whole-UI `zoom` (next section).
- Skeletons: the zoom covers them; `Sk` sizes that stand for layout gaps/padding use `--space-scale` where the real
  layout does.

## Text size: whole-UI scale (decided by the product owner)

Text size is a **whole-UI scale** with CSS `zoom`, not per-font-size scaling: text, icons, spacing and corners grow or
shrink together, like browser zoom for the app only. Chosen because it is a much smaller change and skeletons stay
exact. Accepted trade-off: "Large" makes everything a little bigger, not only the text.

- `zoom: var(--text-scale)` on the root, so dialogs, menus and toasts (portalled to `<body>`) scale with the page.
- The label in the UI stays "Text size" (that is how admins think about it).
- Builder must check under zoom: `100vh`-based heights (sticky sidebar), fixed/sticky elements, chart tooltip placement
  (`getBoundingClientRect`), Recharts sizing, drag-and-drop (`@dnd-kit` pointer maths) and the Kanban overlay. Fix any
  that misbehave (for example divide viewport-height sizes by the scale).

## Left to the builder

Exact option values after visual tuning, the Appearance section's layout inside the Branding panel (following the
panel's existing style), and which per-feature grids count as "layout level".
