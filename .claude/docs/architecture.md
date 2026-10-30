# Frontend architecture: feature-based

The code is grouped by **feature** (a product area), not by file type. A feature folder owns its UI, types and data access.
Shared code lives in `components/`, `hooks/` and `lib/` only when more than one feature needs it.

```
app/                       routes only: thin pages that load data and compose features
  layout.tsx, globals.css, opsdesk.css
  (app)/layout.tsx         route group: loads nav/user/assistant once, wraps every page in <AppShell>
  (app)/(home)/page.tsx    "/" dashboard: getDashboard → <DashboardView/> (own group so its loading.tsx covers only "/")
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
  Shared UI kit (styles in app/styles/kit.css): page-head.tsx (PageHead + PageHeadSkeleton), status-pill.tsx, filter-bar.tsx (FilterBar/Search/Select/Seg),
    empty-state.tsx, field.tsx, confirm-dialog.tsx, detail-sheet.tsx, when.tsx, data-pagination.tsx (+ pager-skeleton.tsx; `lib/paginate.ts` slices rows, every data table uses both); plus `.rtable` (stacked-card tables on phones) and the sonner Toaster (`.od-toast`)
app/styles/                per-feature CSS (shell.css, kit.css, <feature>.css), imported in app/layout.tsx after opsdesk.css
hooks/                     shared hooks (use-dept = department filter context, use-mobile)
lib/                       shared non-UI code: data.ts (getData), store.ts (createStore: per-feature in-memory store), types.ts (Tone, Status, Dept), utils.ts, motion.ts (motion tokens; see ui-rules.md → Motion)
public/data/<feature>/     mock API JSON; folder name == feature name (read from disk by lib/data.ts; proxy.ts 404s /data/* over HTTP)
```

## Rules
1. **One feature, one folder.** Folder name in `features/`, `public/data/` and `.claude/docs/` (when a brief exists) should match.
2. **Import a feature only through its `index.ts`** (`@/features/dashboard`). Inside a feature, use relative imports (`../types`, `./day-details-dialog`).
3. **Features don't import other features.** When a feature needs another feature's UI, the route composes them and passes it in through a slot prop.
   Example: `AppShell` takes `assistant={<AiAssistant/>}` and does not import `features/assistant`.
   When two features need the same code, move that code to `components/`, `hooks/` or `lib/`.
   Shared data works the same way. Keep pure models in `lib/` (server-safe: no React hooks, no `createStore`) and the client store plus hook in `hooks/`:
   - `lib/support-access.ts` + `hooks/use-support-access.ts` (`lib/support-data.ts` loads it on the server): one support-access list for the platform console and tenant Settings → Data & privacy.
   - `lib/devices.ts` + `lib/device-session.ts` (server, reads cookies per request) + `components/drive-link.tsx`: device register, `canUse(feature, device, policies)`; the route computes the decision and passes `driveAllowed` to features. `lib/mfa.ts`: mock two-step rule, TOTP and gate (`app/actions/security.ts`).
   - `lib/notify.ts` (+ `lib/notify-data.ts` on the server) + `hooks/use-notify-feed.ts`: reminder schedule, due reminders, delivery records and previews. The hook owns the shell notification list store and the mock clock; Settings → Notifications and the shell bell both use it.
   - `lib/branding.ts` + `hooks/use-branding.ts`: logo validation, initials, and the in-memory tenant logo store. Settings → Branding writes it, the shell sidebar mark reads it.
   - `lib/task-inbox.ts`: tasks created elsewhere (WhatsApp) are pushed here with their tenant id and merged into that tenant's tasks store by `useTasksStore`. Task changes from elsewhere (end-of-shift report: status + time, `pushUpdates`) are applied the same way by `applyTaskUpdates`, once per update id.
   - `lib/task-voice.ts` + `components/voice-note.tsx` (`VoiceRecorder`, `VoiceNotePlayer`): task voice instructions. Pure helpers (m:ss, 2-minute limit, mime pick) and the `taskVoice` hand-off: New task puts a voiced task there, the Today card reads it (`withVoice`) so "Play my day" can play the recording. Styles `.vn-*` in kit.css.
   - `lib/money.ts`: `moneyFormatter(org.currency, org.locale)`. Never hard-code a currency.
   - `lib/task-evidence.ts`: task evidence rules (CR-05): types, Not needed/Optional/Required, minimum, review mode, what Complete does, evidence state. The tasks feature and the shift-report hand-off read it. `lib/task-notices.ts`: in-app notices to a member when a manager changes their task (outbox with `subscribe`; `hooks/use-notify-feed.ts` adds the person's notices to the shell bell once each). See `features/tasks.md`.
   - `lib/shifts.ts` (+ `lib/shifts-data.ts` on the server) + `hooks/use-shifts.ts`: shift patterns, assignments, teams and reporting lines, reporting on/off (team default + override), shift windows across midnight and DST, report due time. `/shifts` edits it; the end-of-shift report reads it. See `features/shifts.md`.
   - `lib/shift-report.ts` (+ `lib/shift-reports-data.ts` on the server): end-of-shift report model (tasks in a shift, draft/submitted/late/missing/accepted/returned, template validation, submit → task updates, scope own/team/all). `/daily-reports`, notifications (missing alerts) and search read it. See `features/shift-reports.md`.
   - `lib/report-deadline.ts`: the dashboard's shift report deadline card (member: their next report due; manager: per team in scope, due / missing), built from `lib/shift-report.ts` rows and `lib/shifts.ts` due times; loaded by `getReportDeadline` in `features/dashboard/api.ts`.
   - `lib/task-scope.ts`: `activeTasks()` (not archived) and `isAssignee()` / `assigneesOf()` (primary + further assignees). Every reader of `tasks/tasks.json` uses it (tasks, search, shift reports, the Today card), so "my tasks" means the same everywhere.
   - `lib/today.ts` (pure: counts, order, summary, speech, working day, player actions through `lib/task-inbox.ts`) + `lib/today-data.ts` (server, the person's own tasks and team numbers) + `lib/today-prefs.ts` (client: dismissal in localStorage, mirrored to a cookie): the Today card (FR-M1-70..80).
   - `lib/entitlements.ts` (pure: plan → modules, `restrictRole`, `filterByEntitlement`, `planModules`, `withPlanModules`) + `lib/entitlements-data.ts` (server): plan entitlements (FR-M0-15). `billing/entitlements.json` is the one source of truth for what a plan includes; billing, the platform console and the session all read it.
   - `components/sort-header.tsx` (`SortHeader`: sortable `<th>` with `aria-sort`, a button label and a CSS arrow, `.od-sort` in kit.css) + `lib/csv.ts` (`toCsv(rows, columns)`, `csvCell` quoting and formula guard, `downloadCsv`): shared table tooling (platform spec D6). The platform tenants list, billing ledger, data requests and audit log use both; reports' CSV export uses the same cell rules.
   - `lib/platform-notice.ts` (pure: `activeNotice`, `noticeKey`) + `lib/platform-notice-data.ts` (server, reads `platform/settings.json`) + `components/platform-notice.tsx` (`PlatformNoticeBanner`, `.od-notice*` in shell.css): the platform announcement (console spec D10). The console's Settings preview and every tenant app shell (`app/(app)/layout.tsx`) show it. See `features/platform.md`.
   - `components/copy-id.tsx` (`CopyId`: copy button with a drawn tick and toast, `.od-copy` in kit.css; `.od-copy-inline` inside a text line) + `lib/clipboard.ts` (`copyText`: Clipboard API with a hidden-textarea fallback): copyable IDs (tenant id, invoice number, request id, audit entry).
   - `lib/audit-outbox.ts`: audit events recorded outside the audit log screen (e.g. a task purge, FR-M0-13), pushed with their tenant id and merged into the audit store once per key (`mergeOutbox` in `features/audit/filters.ts`).
4. **Client components never import `api.ts` or the feature's `index.ts`.** `index.ts` re-exports `api.ts`, which uses `fs`, so that import would break the client bundle.
   Client components import siblings and `../types` directly.
5. **Data flow:** the route (server) calls feature `api.ts` → props → components. Components never fetch mock JSON themselves.
   To go to a real backend, swap `getData()` in `lib/data.ts`, or one feature's `api.ts`, for `fetch()`; components don't change.
6. **Types:** a type used by one feature goes in its `types.ts`. A type used by several features goes in `lib/types.ts`.
7. **shadcn:** `npx shadcn add <x>` still installs into `components/ui/` (shared). Re-skin per `00-design-system/ui-rules.md`.
8. **CSS:** global OpsDesk styles live in `app/opsdesk.css`. Per-feature (and shared kit) CSS lives in `app/styles/<feature>.css`, imported in `app/layout.tsx`. Unlayered classes there beat Tailwind utilities on shadcn primitives.

## Adding a new feature (e.g. `tasks` page)
1. `public/data/tasks/*.json` with the mock responses.
2. `features/tasks/{types.ts, api.ts, components/, components/skeletons.tsx, index.ts}`.
   Add a skeleton for every component (see Skeletons below), plus `app/(app)/tasks/loading.tsx`.
3. Route `app/(app)/tasks/page.tsx`: load via `getX()` from `@/features/tasks`. The `(app)` layout already wraps it in the shell.
   Every sidebar href now has its own route (the old `[section]` Coming soon catch-all was removed). A new nav item needs its own route folder.
   Sidebar links and active state come from `public/data/shell/navigation.json` (`href`, `description`, `srs`).
   Pages fill the viewport (`.app/.main` min-height 100dvh, `.canvas` flex:1). Keep that when adding page-level wrappers.
4. Check the module's section in `requirements/SRS.md` (main spec) first, and its Appendix A for build status. Old IDs in code comments (`FR-TASK-*`, `FR-REP-*`, `OC-*`) refer to `requirements/SRS-v1.2-built.md`.

## Skeletons (required for every page and component)
Every page and every data-driven component must have a loading skeleton that matches it **exactly**: same layout, same size, nothing jumps when data arrives.

**Where things live**
- Primitive: `components/sk.tsx`
  - `<Sk w h r lh />` draws one shimmer block.
  - `<SkGroup label>` wraps a page skeleton and announces "Loading…" once to screen readers. Every block inside is `aria-hidden`.
- Per feature: `features/<feature>/components/skeletons.tsx`
  - One `XxxSkeleton` per component, next to the component it mirrors.
  - Plus a page-level skeleton (e.g. `DashboardSkeleton`), exported from the feature's `index.ts`.
- Routes: a `loading.tsx` next to each `page.tsx` renders that page's skeleton.
  - `app/loading.tsx` covers the first load: it shows `AppShellSkeleton` + `PageSkeleton` while the `(app)` layout fetches nav and user.
  - `app/(app)/(home)/loading.tsx` shows the dashboard skeleton. Never put a `loading.tsx` directly in `app/(app)/`: a loading file wraps every route below it, so its skeleton would flash on every page.
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
   Last check (28 Oct 2026, measured in same-origin iframes at 1920, 1568, 768 and 390px): skeleton and loaded page agree within 0.7px for `.head`, `.stat` (169.4 at desktop, 151.4 at 390), stat notes, `.card` and coverage rows (1 or 2 lines by width) on the dashboard, and for every card, usage row, plan card and invoice row on `/settings/billing`.
   Phase 1 check (30 Oct 2026, same method, 1568, 768 and 390px): every Phase 1 page agrees within 1px at 1568 (Today card, deadline card, `/daily-reports`, `/tasks` list/board/calendar/projects/archive, `/tasks/TSK-1001` and `TSK-1005`, a report review page, `/shifts`, settings devices/integrations/roles/billing, account security/notifications, tenant detail) and at 768; at 390 all of them agree too (tasks list and member prompt card within 0.7px, employee `/tasks` at 768 row for row). Table skeletons also ghost the header labels and the repeat/checklist badges (real markup), because they set the column min-widths. Detail pages (`/tasks/[ref]`, `/daily-reports/[id]`) use `SkMask` (components/sk.tsx): loading.tsx reads the pathname from the `x-od-path` request header that `proxy.ts` sets (`lib/request-path.ts`), looks the record up and renders the real component masked (CSS `.sk-mask` in kit.css), so layout is identical by construction; an unknown id falls back to the typical-counts skeleton. Other rules learned: the loading route computes the same derived rows as the page (recurring tasks via `materialiseRecurring`, board "Move to" via `boardMove`, calendar chips via `byDueDay`); status pill and evidence tag are real `.st` / `.ev-tag` ghost text (one line); tables and lists use the real row text as ghost text in every cell, so wrapping matches at 768 and 390.
   Text that wraps (stat notes, coverage rows, invoice rows) is ghost text (`.sk-ghost`, shared rules in `app/styles/kit.css`) built from the same seed data the `loading.tsx` route already fetches.
6. **Keep them in sync.** When you change a component's markup, data count or text size, update its skeleton in the same change.
7. Check dark mode. Reduced motion already turns the shimmer off through the global rule.

## SaaS readiness
The product is a modular multi-tenant SaaS (SRS §2, FR-M0-01/02), billed through Stripe for now (FR-M0-14). Other payment methods are added later as adapters.
- Each module is switched on by plan entitlement; a module not in the plan is hidden in the UI (FR-M0-15). Hide later-phase pages, don't delete them.
- Never hard-code tenant-specific values in components: company name, departments, the 5:30 PM deadline, timezone, branding, approver names. They come from data (today JSON, later the tenant settings API).
- Future platform features are planned as their own folders: `features/tenant` (settings, branding, members), `features/billing` (plans, Stripe checkout/portal; UI talks only to the billing module, never Stripe directly) and `features/platform-admin`.
