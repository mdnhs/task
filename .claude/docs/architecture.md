# Frontend architecture: feature-based

The code is grouped by **feature** (a product area), not by file type. A feature folder owns its UI, types and data access.
Shared code lives in `components/`, `hooks/` and `lib/` only when more than one feature needs it.

```
app/                       routes only: thin pages that load data and compose features
  layout.tsx, globals.css, opsdesk.css
  (app)/layout.tsx         route group: loads nav/user/assistant once, wraps every page in <AppShell>
  (app)/page.tsx           "/" dashboard: getDashboard → <DashboardView/>
  (app)/[section]/page.tsx "Coming soon" for every sidebar href not built yet (static params from navigation.json)
features/
  <feature>/
    components/            the feature's UI (client or server components)
    api.ts                 data access for the feature (server-only; today reads public/data/<feature>/*.json)
    types.ts               the feature's data types
    index.ts               the public API: the only file other code imports from
  shell/                   app frame: sidebar, topbar, department filter, NavUser menu
  assistant/               OpsDesk AI panel (chat, image upload)
  dashboard/               dashboard widgets + DashboardView
components/                shared, feature-agnostic UI
  ui/                      shadcn primitives (re-skinned via opsdesk.css; see 00-design-system/ui-rules.md)
  icons.tsx, theme-provider.tsx, sk.tsx, count-up.tsx, roll-number.tsx, reveal-observer.tsx (scroll reveal)
hooks/                     shared hooks (use-dept = department filter context, use-mobile)
lib/                       shared non-UI code: data.ts (getData), types.ts (Tone, Status, Dept), utils.ts, motion.ts (motion tokens; see ui-rules.md → Motion)
public/data/<feature>/     mock API JSON; folder name == feature name
```

## Rules
1. **One feature, one folder.** Folder name in `features/`, `public/data/` and `.claude/docs/` (when a brief exists) should match.
2. **Import a feature only through its `index.ts`** (`@/features/dashboard`). Inside a feature, use relative imports (`../types`, `./day-details-dialog`).
3. **Features don't import other features.** When a feature needs another feature's UI, the route composes them and passes it in through a slot prop.
   Example: `AppShell` takes `assistant={<AiAssistant/>}` and does not import `features/assistant`.
   When two features need the same code, move that code to `components/`, `hooks/` or `lib/`.
4. **Client components never import `api.ts` or the feature's `index.ts`.** `index.ts` re-exports `api.ts`, which uses `fs`, so that import would break the client bundle.
   Client components import siblings and `../types` directly.
5. **Data flow:** the route (server) calls feature `api.ts` → props → components. Components never fetch mock JSON themselves.
   To go to a real backend, swap `getData()` in `lib/data.ts`, or one feature's `api.ts`, for `fetch()`; components don't change.
6. **Types:** a type used by one feature goes in its `types.ts`. A type used by several features goes in `lib/types.ts`.
7. **shadcn:** `npx shadcn add <x>` still installs into `components/ui/` (shared). Re-skin per `00-design-system/ui-rules.md`.
8. **CSS:** OpsDesk styles live in `app/opsdesk.css`, with each feature's rules grouped under a comment header. Per-feature CSS files are a possible later step.

## Adding a new feature (e.g. `tasks` page)
1. `public/data/tasks/*.json` with the mock responses.
2. `features/tasks/{types.ts, api.ts, components/, components/skeletons.tsx, index.ts}`.
   Add a skeleton for every component (see Skeletons below), plus `app/(app)/tasks/loading.tsx`.
3. Route `app/(app)/tasks/page.tsx`: load via `getX()` from `@/features/tasks`. The `(app)` layout already wraps it in the shell.
   A static folder beats `[section]`, so the Coming soon page for that href disappears by itself.
   Sidebar links, active state and Coming soon text all come from `public/data/shell/navigation.json` (`href`, `description`, `srs`).
   Pages fill the viewport (`.app/.main` min-height 100dvh, `.canvas` flex:1). Keep that when adding page-level wrappers.
4. Check the SRS section for that module (`requirements/SRS.md`) first.

## Skeletons (required for every page and component)
Every page and every data-driven component must have a loading skeleton that matches it **exactly**: same layout, same size, nothing jumps when data arrives.

**Where things live**
- Primitive: `components/sk.tsx`
  - `<Sk w h r lh />` draws one shimmer block.
  - `<SkGroup label>` wraps a page skeleton and announces "Loading…" once to screen readers. Every block inside is `aria-hidden`.
- Per feature: `features/<feature>/components/skeletons.tsx`
  - One `XxxSkeleton` per component, next to the component it mirrors.
  - Plus a page-level skeleton (`DashboardSkeleton`, `ComingSoonSkeleton`), exported from the feature's `index.ts`.
- Routes: a `loading.tsx` next to each `page.tsx` renders that page's skeleton.
  - `app/loading.tsx` covers the first load: it shows `AppShellSkeleton` + `PageSkeleton` while the `(app)` layout fetches nav and user.
  - `app/(app)/loading.tsx` shows the dashboard skeleton.
  - `app/(app)/[section]/loading.tsx` shows the Coming soon skeleton.
  - A new route gets its own `loading.tsx`.
- CSS: `.sk*` rules at the end of `app/opsdesk.css`.
  - The tint is based on `--ink`, so it works on every surface in both themes.
  - On the topbar, blocks use `.sk-on-panel`, which matches the white controls.

**How to make one accurate**
1. **Reuse the real classes.** Build the skeleton with the component's own wrappers (`.card`, `.card-head`, `.stat`, `.item`, `.cov-row`, `table`…) and swap only the text and data for `<Sk>`.
   Padding, gap, grid and borders then come out identical. Never invent new layout CSS for a skeleton.
2. **Static parts render for real.** Logo, nav section labels and the app promo card are shared components (`sidebar-parts.tsx`), not blocks.
3. **Size text with `lh`.** Measure each text element's real height in the browser (`getBoundingClientRect().height`) and pass it as `lh`.
   `h` is only the visible bar inside it. For example a 19px `h2` → `<Sk h={18} lh={28} />`.
4. **Match counts and wrapping to the data:** same number of rows, and the same line count where real text wraps (for example the first coverage row has 2 lines).
5. **Verify.** Temporarily add `await new Promise(r => setTimeout(r, 15000))` to the page. In the browser, compare the heights of `.head`, `.stat` and `.card` for the skeleton and the loaded page. They must be equal. Remove the delay afterwards.
   Last check (28 Oct 2026, 1568px wide):
   - Dashboard: `68,169×4,428,428,374,374,532,532`, identical for skeleton and loaded page.
   - Coming soon: `68,603`, identical for both.
6. **Keep them in sync.** When you change a component's markup, data count or text size, update its skeleton in the same change.
7. Check dark mode. Reduced motion already turns the shimmer off through the global rule.

## SaaS readiness (SRS v1.1)
The product is a multi-tenant SaaS (SRS §3.20), billed through Stripe for now (FR-SAAS-07). Other payment methods are added later as adapters (FR-SAAS-07a).
- Never hard-code tenant-specific values in components: company name, departments, the 5:30 PM deadline, timezone, branding, approver names. They come from data (today JSON, later the tenant settings API).
- Future platform features are planned as their own folders: `features/tenant` (settings, branding, members), `features/billing` (plans, Stripe checkout/portal; UI talks only to the billing module, never Stripe directly) and `features/platform-admin`.
