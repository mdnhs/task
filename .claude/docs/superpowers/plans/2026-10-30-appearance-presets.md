# Workspace Appearance Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace admin pick Corners, Text size and Spacing presets in Settings → Branding; everyone in that tenant sees them.

**Architecture:** Three CSS scale tokens (`--radius-scale`, `--text-scale`, `--space-scale`) on `:root`, emitted server-side next to the brand colour (same `<style id="od-brand">`, same per-tenant cookie). Radii and layout spacing multiply by their token; text size is a whole-UI `zoom` on `body`.

**Tech Stack:** Next.js 16 (app router, server actions), plain CSS tokens (`app/opsdesk.css`, `app/styles/*.css`), Vitest.

**Spec:** `.claude/docs/superpowers/specs/2026-10-30-appearance-presets-design.md`

## Global Constraints

- Options, middle = today's look: Corners `sharp 0.4 · soft 1 · round 1.4`; Text `small 0.92 · default 1 · large 1.1`; Spacing `compact 0.75 · comfortable 1 · spacious 1.3`.
- `--r-pill` stays `999px` (pills stay pills).
- Defaults emit no CSS (like `brandCss` for the default colour), so the stock look is byte-identical.
- Write access = `canWrite(session, "settings")`, same as `saveBranding`.
- Tokens only; motion/ui rules from `.claude/docs/00-design-system/ui-rules.md` apply to the new UI.
- Never hard-code tenant values. Skeletons must match (architecture.md → Skeletons).

## Review Focus

- A cookie with an unknown preset value (old/garbled) → falls back to default per field, no crash (Task 1 test).
- Text size Large + Spacing Spacious on a 1280px screen → no horizontal scroll, sticky sidebar fits the viewport (Task 3 check).
- Leaving the Branding page without saving → the saved look returns everywhere (Task 4 check).
- Chart tooltip, Kanban drag and dialogs under `zoom ≠ 1` → positioned correctly (Task 3 check).
- Read-only admin (suspended tenant) → options visible but disabled, save refused server-side (Task 2 test via `saveBranding` guard; Task 3 UI).

---

### Task 1: Appearance model and CSS

**Files:**
- Create: `lib/appearance.ts`
- Test: `lib/appearance.test.ts`

**Interfaces:**
- Produces:
  - `type Corners = "sharp" | "soft" | "round"`, `type TextSize = "small" | "default" | "large"`, `type Spacing = "compact" | "comfortable" | "spacious"`
  - `type Appearance = { corners: Corners; text: TextSize; spacing: Spacing }`
  - `const DEFAULT_APPEARANCE: Appearance` (`soft / default / comfortable`)
  - `const APPEARANCE_OPTIONS: { corners: Opt<Corners>[]; text: Opt<TextSize>[]; spacing: Opt<Spacing>[] }` where `Opt<T> = { value: T; label: string; scale: number }` (labels: Sharp, Soft, Round · Small, Default, Large · Compact, Comfortable, Spacious)
  - `parseAppearance(raw: unknown): Appearance`
  - `appearanceCss(a: Appearance): string`

- [ ] **Step 1: Write the failing tests** in `lib/appearance.test.ts`:
  - `appearanceCss(DEFAULT_APPEARANCE)` → `""`
  - `appearanceCss({ corners: "sharp", text: "default", spacing: "comfortable" })` → `":root{--radius-scale:0.4}"`
  - `appearanceCss({ corners: "round", text: "large", spacing: "compact" })` contains `--radius-scale:1.4`, `--text-scale:1.1`, `--space-scale:0.75`
  - `parseAppearance(undefined)` and `parseAppearance("x")` → `DEFAULT_APPEARANCE`
  - `parseAppearance({ corners: "round", text: "huge" })` → `{ corners: "round", text: "default", spacing: "comfortable" }`
- [ ] **Step 2:** `npx vitest run lib/appearance.test.ts` → FAIL (module missing)
- [ ] **Step 3: Implement `lib/appearance.ts`.** `appearanceCss` emits only the non-default tokens inside one `:root{…}`.
- [ ] **Step 4:** `npx vitest run lib/appearance.test.ts` → PASS
- [ ] **Step 5: Commit** `feat: appearance presets model`

### Task 2: Persist and apply server-side

**Files:**
- Modify: `lib/types.ts` (`Tenant` gets `appearance?: Appearance`)
- Modify: `lib/session.ts` (`withBranding` reads `b.appearance` via `parseAppearance`)
- Modify: `app/actions/session.ts` (`saveBranding(input: { name: string; color: string; appearance?: Appearance })` stores it in the same `od-brand-<tenantId>` cookie, validated with `parseAppearance`)
- Modify: `app/(app)/layout.tsx:47` (style tag = `brandCss(...) + appearanceCss(session.tenant.appearance ?? DEFAULT_APPEARANCE)`)

**Interfaces:**
- Consumes: Task 1 `Appearance`, `parseAppearance`, `appearanceCss`, `DEFAULT_APPEARANCE`
- Produces: `session.tenant.appearance: Appearance | undefined`; `saveBranding` accepts `appearance`

- [ ] **Step 1:** Implement the four edits. Keep `saveBranding`'s existing write guard first.
- [ ] **Step 2:** `npx tsc --noEmit -p .` → no errors in touched files; `npx vitest run lib` → PASS
- [ ] **Step 3: Commit** `feat: persist workspace appearance with branding`

### Task 3: Tokens in the stylesheets

**Files:**
- Modify: `app/opsdesk.css` (`--r-xl/lg/md` → `calc(<base> * var(--radius-scale,1))`; `body{zoom:var(--text-scale,1)}`; layout spacing)
- Modify: `app/opsdesk.css`, `app/styles/*.css` (the 76 hard-coded `border-radius:Npx` → `calc(Npx * var(--radius-scale,1))`, mechanical pass; skip `50%` and `999px`)
- Modify: `features/*/components/skeletons.tsx` only where a skeleton hard-codes a layout gap/padding that the real layout now scales

- [ ] **Step 1:** Radius pass. Verify: `grep -oE "border-radius:[0-9.]+px" app/*.css app/styles/*.css | wc -l` → `0`.
- [ ] **Step 2:** Spacing: multiply by `var(--space-scale,1)` for body padding-block, `.app` / `.sidebar` / `.main` padding, `.canvas` stack gap, `.card` padding, `.card-head` margin-bottom, `.stats` / `.grid-2` / `.grid-3` gaps, `.sidebar-scroll` gap, and the sticky logo/strip offsets added in the sidebar (88px top pad, 22px strip).
- [ ] **Step 3:** Zoom fixes: `100vh` heights divide by `var(--text-scale,1)` (sticky `.sidebar`, any `calc(100vh …)`); check chart tooltip (`tasks-closed-chart.tsx` `placeTip`), Recharts sizing, `@dnd-kit` Kanban drag (`features/recruitment/components/pipeline.tsx`), dialogs, toasts.
- [ ] **Step 4:** Browser check at default → pixel-identical to before (compare card sizes via `getBoundingClientRect` on the dashboard); then all-small and all-large combinations at 1280px and 390px: no horizontal scroll, no clipped fixed-height cards (`.dash-fix`), skeleton → page has no jump.
- [ ] **Step 5:** `npx tsc --noEmit -p .`, `npx vitest run`, `npx eslint .` → clean
- [ ] **Step 6: Commit** `feat: radius, spacing and zoom tokens for appearance presets`

### Task 4: Appearance section in Settings → Branding

**Files:**
- Modify: `features/settings/components/branding-panel.tsx` (new `appearance` prop; three option groups under "Brand colour"; included in save and in the "Previewing…" check; Reset to default)
- Modify: `app/(app)/settings/[tab]/page.tsx:92` (pass `appearance={tenant.appearance ?? DEFAULT_APPEARANCE}`)
- Modify: `features/settings/components/skeletons.tsx` (branding skeleton gets the three option rows)
- Modify: `app/styles/settings.css` (option pill styles; reuse the `.decide-opt` look: pill, `--mute-bg`, checked = `--brand-soft`)

**Interfaces:**
- Consumes: Task 1 `APPEARANCE_OPTIONS`, `appearanceCss`; Task 2 `saveBranding({ name, color, appearance })`

- [ ] **Step 1:** Each group is a `RadioGroup` (`components/ui/radio-group.tsx`) with a visible label (Corners / Text size / Spacing), options as pills, disabled when `!canWrite`.
- [ ] **Step 2:** Live preview: the existing effect that writes `brandCss(chip)` into `#od-brand` also appends `appearanceCss(form.appearance)`; the unmount restore appends the saved appearance.
- [ ] **Step 3:** Browser check (light + dark): pick Sharp → every card/button radius shrinks app-wide; leave the page without saving → original returns; Save → reload keeps it; read-only role → pills disabled.
- [ ] **Step 4: Commit** `feat: appearance presets in branding settings`

