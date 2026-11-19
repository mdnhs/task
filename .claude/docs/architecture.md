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
   - `lib/support-access.ts`: the pure support-grant model and status labels used by the tenant Settings skeleton. The grants themselves are the API's (`/v1/platform/.../support-grants`, `/v1/settings/support-grants`); the old mock store and loader are gone (B6 T6.8).
   - `lib/devices.ts` + `lib/device-session.ts` (server, reads cookies per request) + `components/drive-link.tsx`: device register, `canUse(feature, device, policies)`; the route computes the decision and passes `driveAllowed` to features. `lib/mfa.ts`: mock two-step rule, TOTP and gate (`app/actions/security.ts`).
   - `lib/rosters.ts`, `lib/roster-access.ts`, `lib/roster-rules.ts`, `lib/roster-repeat.ts` (repeat and week templates), `lib/ics.ts` (`.ics` export) + `lib/workforce.ts`: location rosters and the one person list. `features/rosters` and `features/shifts` / `features/staff-rosters` share them through `lib/` (`lib/shifts-data.ts` overlays published roster shifts).
   - `lib/notify.ts`: reminder schedule, due reminders, delivery records and previews (pure; the notification SETTINGS preview, mock until its backend exists). `hooks/notify-clock.ts` is that preview's mock clock. The shell bell is the API's (T6.4): `lib/notifications.ts` (adapter, mark read, the 60 s poll while the tab is visible) + `hooks/use-notifications.ts`; there is no client outbox.
   - `lib/branding.ts` + `hooks/use-branding.ts`: logo validation, initials, and the in-memory tenant logo store. Settings → Branding writes it, the shell sidebar mark reads it.
   - `lib/task-voice.ts` + `components/voice-note.tsx` (`VoiceRecorder`, `VoiceNotePlayer`): task voice instructions. Pure helpers (m:ss, 2-minute limit, mime pick) and the `taskVoice` hand-off: New task puts a voiced task there, the Today card reads it (`withVoice`) so "Play my day" can play the recording. Styles `.vn-*` in kit.css.
   - `lib/money.ts`: `moneyFormatter(org.currency, org.locale)`. Never hard-code a currency.
   - `lib/task-evidence.ts`: task evidence rules (CR-05): types, Not needed/Optional/Required, minimum, review mode, what Complete does, evidence state. The tasks feature and the shift-report hand-off read it. Task notices are written by the API and listed by the shell bell (T6.4).
   - `lib/shifts.ts` (pure model; the screens read the API through `features/shifts`): shift patterns, assignments, teams and reporting lines, reporting on/off (team default + override), shift windows across midnight and DST, report due time. `/shifts` edits it; the end-of-shift report reads it. See `features/shifts.md`.
   - `lib/shift-report.ts` (pure rules; the screens read the API through `features/reports`): end-of-shift report model (tasks in a shift, draft/submitted/late/missing/accepted/returned, template validation, submit → task updates, scope own/team/all). `/daily-reports`, notifications (missing alerts) and search read it. See `features/shift-reports.md`.
   - `lib/report-deadline.ts`: the dashboard's shift report deadline card (member: their next report due; manager: per team in scope, due / missing), built from `lib/shift-report.ts` rows and `lib/shifts.ts` due times; loaded by `getReportDeadline` in `features/dashboard/api.ts`.
   - `lib/task-scope.ts`: `activeTasks()` (not archived) and `isAssignee()` / `assigneesOf()` (primary + further assignees). Every reader of `tasks/tasks.json` uses it (tasks, search, shift reports, the Today card), so "my tasks" means the same everywhere.
   - `lib/today.ts` (pure: counts, order, summary, speech, working day, the card's "Mark done" and "Snooze" are `POST /v1/today/updates`) + the Today card on `GET /v1/today` (`features/dashboard`) + `lib/today-prefs.ts` (client: dismissal in localStorage, mirrored to a cookie): the Today card (FR-M1-70..80).
   - `lib/entitlements.ts` (pure: plan → modules, `restrictRole`, `filterByEntitlement`, `planModules`, `withPlanModules`) + `lib/entitlements-data.ts` (server): plan entitlements (FR-M0-15). `billing/entitlements.json` is the one source of truth for what a plan includes; billing, the platform console and the session all read it.
   - Shell data from the API (B6 T6.4): `lib/org.ts` + `lib/org-core.ts` (`getOrg()`: zone, currency, locale, report deadline from `/v1/me/tenant`, departments from `/v1/teams?kind=department`, `today` = the server clock in the tenant zone; only endpoints a plain member may call), `lib/people.ts` (`getPeople()` maps `/v1/people`: user id, role label, department from the team, stable avatar, "Former member" for the erased), `lib/entitlements-data.ts` (`getTenantEntitlements()`, never cached), `lib/billing-state.ts` + `components/billing-banner.tsx` (grace and read-only banner; a 402 seen by `lib/api/browser.ts` flips it through `lib/api/blocked.ts`), `lib/api/action.ts` + `hooks/use-api-action.ts` (one request per action, rollback, refresh). Pages still on mock records call `getMockOrg()` / `getMockPeople()` (greppable) until T6.5 to T6.8 switch them.
   - `components/sort-header.tsx` (`SortHeader`: sortable `<th>` with `aria-sort`, a button label and a CSS arrow, `.od-sort` in kit.css) + `lib/csv.ts` (`toCsv(rows, columns)`, `csvCell` quoting and formula guard, `downloadCsv`): shared table tooling (platform spec D6). The platform tenants list, billing ledger, data requests and audit log use both; reports' CSV export uses the same cell rules.
   - `components/form-section.tsx` (`FormSection`, `OptionalTag`, `FoldToggle` + `FormFold`, `PeoplePicker`; `.fs-*` in kit.css): the shared form layout (ui-rules rule 32). The New task page is the reference.
   - `lib/platform-notice.ts` (pure: `activeNotice`, `noticeKey`) + `lib/platform-notice-data.ts` (server, reads `platform/settings.json`) + `components/platform-notice.tsx` (`PlatformNoticeBanner`, `.od-notice*` in shell.css): the platform announcement (console spec D10). The console's Settings preview and every tenant app shell (`app/(app)/layout.tsx`) show it. See `features/platform.md`.
   - `components/copy-id.tsx` (`CopyId`: copy button with a drawn tick and toast, `.od-copy` in kit.css; `.od-copy-inline` inside a text line) + `lib/clipboard.ts` (`copyText`: Clipboard API with a hidden-textarea fallback): copyable IDs (tenant id, invoice number, request id, audit entry).
   - Audit events recorded outside the audit log screen (a task purge, FR-M0-13) are written by the API in the same transaction; the old client outbox (`lib/audit-outbox.ts`) is gone (T6.4).
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

## Data layer (B6, switch from mock JSON to the API)
Mock features keep `features/<f>/api.ts` + `lib/data.ts` until their task switches them (B6 ruling I16). Everything below is the transport those switches use (`lib/api/*`).

**Types come from the OpenAPI document, not from `hc<AppType>`** (`AppType` carries no routes, ruling I2). `npm run api:types` dumps the API's OpenAPI 3.1 document (`api/scripts/dump-openapi.ts`, stub dependencies, test-only routes excluded) and turns it into the committed `lib/api/schema.d.ts` with `openapi-typescript` (a devDependency). `npm run api:types:check` regenerates in memory and fails when the file differs; it runs in CI (`ci.yml` job `contract-types`) and in the deploy gate (`deploy.yml`). A DTO change in `api/` means `npm run api:types` and committing the result. Never edit `schema.d.ts` by hand. The web imports types only (`import type { paths }`), so no server code reaches the bundle. There is no `packages/contracts`: DTO schemas live next to their routes in the API, shared pure rules in `packages/domain`.

**Who calls what**
| Caller | Client | Goes to | Tenant and cookies |
|---|---|---|---|
| Browser (client components) | `apiBrowser` (`lib/api/browser.ts`) | same-origin `/v1/*` and `/api/auth/*` route handlers (BFF) | the browser sends its own httpOnly cookies; the BFF builds `X-Tenant` |
| BFF (`app/v1/[...path]/route.ts`, `app/api/auth/[...path]/route.ts`) | `forwardToApi` (`lib/api/bff.ts`) | `API_URL` | see rules below |
| Server components, server actions | `apiServer()` (`lib/api/server.ts`, `server-only`) | `API_URL` directly, no hop | allow-listed cookies, `X-Tenant` from `od-tenant`, `Origin` on writes, `cache: "no-store"` |
| Stripe webhooks | none | the API host directly (`/webhooks/billing/*`), never the BFF | the provider signature |

`lib/api/client.ts` (`makeApiClient`, generic over `paths`) is the one typed client; a `fetch` can be injected (the contract tests pass the real app's `app.request`). Errors are `ApiError` (`lib/api/problem.ts`): `classifyApiError()` gives one `ErrorKind` per row of the plan's error table (the three MFA shapes collapse to `mfa_challenge` / `mfa_enrolment`), `userMessage()` gives short copy plus `Ref <requestId>`; the raw `title` and server text are never shown. `lib/auth-client.ts` wraps the 12 Better Auth endpoints with zod-typed answers; the contract tests pin its paths and bodies.

**BFF rules (security, ruling I4-I6, I21)**
- Path must be `/v1/...` or `/api/auth/...` exactly: no dot segments (raw or encoded), no `//`, no encoded slash or backslash, and no percent escape at all under `/api/auth` (no Better Auth endpoint needs one). `/api/auth/list-sessions` (raw tokens) is a 404 in every spelling (the deny rule also runs on the decoded, lower-cased, slash-collapsed path). Methods GET POST PUT PATCH DELETE.
- Request headers dropped: `x-tenant`, `authorization`, `cookie` (rebuilt from the allow-list), `host`, `x-forwarded-*` except `x-forwarded-for`, every `x-od-*`. `Origin: <APP_ORIGIN>` is set on every non-GET.
- Cookie allow-list (`lib/api/cookies.ts`): `better-auth.*`, `__Secure-better-auth.*`, `__Host-od-device-*` (plain `od-device-*` outside production). `od-tenant` and everything else stay home.
- Tenant: `X-Tenant` comes only from the httpOnly cookie `od-tenant` (the slug, `lib/tenant-cookie.ts`, server-only). The page sends `x-od-tenant` (the tenant it was rendered for); a mismatch with the cookie is `409 tenant_changed` with no upstream call. The API's membership check stays the authority.
- CSRF, three layers: the BFF refuses a non-GET whose `Origin` is not exactly the web origin (or whose `Sec-Fetch-Site` is not `same-origin`, or with no `Origin`): `403 bad_origin`; the API has `requireSameOrigin` on `/v1/*` (a present foreign `Origin` on a non-GET is `403 bad_origin`; no `Origin` and Bearer `odk_` keys pass); `proxy.ts` gives every Next server action POST its own Origin check (Next lets a missing Origin through); in production an unset or invalid `APP_ORIGIN` refuses every server action (fail closed, like the BFF; only dev and tests fall back to the Host header).
- `redirect: "manual"` (a presigned 302 and the Google callback reach the browser), body read with a 2 MiB cap (413), 30 s timeout, `Set-Cookie` copied one by one unchanged (a stray `od-tenant` is dropped). An unreachable upstream, a 502 or a non-problem 5xx becomes `502 upstream_unavailable` problem+json with a fresh request id and no upstream text; a real problem body passes through untouched.

**Env (server only, never `NEXT_PUBLIC_*`)**: `API_URL` (internal API address), `APP_ORIGIN` (public web origin = the API's `APP_URL`). `instrumentation.ts` runs `assertServerEnv()` (`lib/env.ts`) once at server start: in production a missing or malformed `APP_ORIGIN` or `API_URL` is a boot error that names the variable (never its value); dev, test and `next build` are never blocked. `npm run check:bundle` (after `next build`, also in the deploy gate) greps `.next/static` for the `API_URL` value, `odk_`, `BETTER_AUTH_SECRET`, `sk_live`, `sk_test`, `whsec_`.

**Tests**: pure units (default `npx vitest run`, fake `fetch`): `lib/api/*.test.ts`, `app/v1/route.test.ts`, `app/api/auth/route.test.ts`, `proxy.test.ts`. Contract tests (`npm run test:contract`, Docker): `test/contract/` boots the real API in process through `api/test/harness`. The API's own `test/openapi-typed.test.ts` fails on any untyped 2xx JSON response (the only free-form values are the audit `before`/`after`).


## Auth and session (B6 T6.3)
The session is the real Better Auth cookie (httpOnly, set by the API, replayed by the BFF). **`proxy.ts` is only an optimistic redirect** (no `better-auth.session_token` cookie, page navigation: to `/sign-in?next=`); it is not authorisation. The real check is `getSession()` (`lib/session.ts`, `lib/session-core.ts`): one `GET /v1/me` per request (React `cache`), then `/v1/me/tenant` and `/v1/entitlements` for the chosen company. A 401 means "expired": the layout redirects to `/api/session/expired`, a route handler (a server component cannot delete cookies) that clears the Better Auth and `od-tenant` cookies only when the API itself says the session is dead, then `/sign-in?reason=expired`. The sign-in page never redirects, so there is no loop. A missing or stale `od-tenant` is repaired by `/api/session/tenant` (B7: the write is a same-origin **POST**; a server redirect can only GET, so the GET answers a self-submitting form and never writes) with the same tenant pick as `getSession` (the cookie's slug if it is a membership, else the first membership that answers; a 404 skips a removed or suspended one). Browser stores go through `clearClientStores(reason)` (`lib/client-stores.ts`: `sign_out`, `expired` on the sign-in landing, `revoked` when a call or action sees a 401 `session_expired`, `tenant_switch`); the Today cookie mirror is `od-today-<auto|dismissed>-<tenant>_<user>`. `getPlatformSession()` serves the console (staff need no company), `peekSession()` never redirects (skeletons).
- **Role** = the membership role from `/v1/me/tenant.member.role` (label, home, access), narrowed to the plan; unknown access values are `none`. No "View as", no device switcher. The company switcher shows only with 2+ memberships and calls `switchTenant(slug)` (server action): the slug must be one of `/v1/me`'s memberships and `/v1/me/tenant` must answer for it before `od-tenant` is written (httpOnly, Lax, Secure in production, host-only).
- **Sign-in** (`lib/auth-flow.ts`): one message for every credential failure (no enumeration), 429 copy, 403 `email_not_verified` offers a resend, `twoFactorRedirect` shows the code step (6 digits or a recovery code), then `afterSignIn(next)` writes `od-tenant` = first membership and redirects to a validated same-origin path (`lib/safe-next.ts`), `/platform` for staff without a company, `/onboarding` otherwise. Sign-up creates no session; `/verify-email` calls the API only on the Verify click; forgot password shows one confirmation for any address; `/reset-password` strips the token from the URL and sends it only in a POST body. Both token pages send `Referrer-Policy: no-referrer`.
- **MFA**: `/v1/me/tenant` answers 401 `mfa_enrolment_required` (the layout shows `MfaGate`, a TOTP set-up with the secret and the `otpauth://` link, no QR) or 401 `mfa_challenge` (the layout shows `MfaStepUp`). Backup codes are shown once.
- **Sessions**: Security tab lists `GET /v1/me/sessions` (label, last active; no token, IP or location); `DELETE /v1/me/sessions/{id}` removes one (own only), `revoke-other-sessions` the rest. Better Auth's `/list-sessions` (raw tokens) is blocked at the BFF.
- **Loading skeletons call no API (I9, K1)**: no `loading.tsx` (root included) reaches `getSession`, `apiServer` or any helper that does; `lib/skeleton-session.ts` gives them the typical owner/business case from seed files, `app/(platform)/skeleton-gate.ts` the console. `test/auth-static.test.ts` scans every `loading.tsx` with a call-graph taint check. Data helpers a skeleton shares with its page take the session as an argument (`getShiftState(session)`, the roster gates).
- **Pages that call the API gate themselves**: `requireMfaOk()` (`lib/session.ts`) returns a session with the second factor in order or redirects to `/mfa` (the layout shows the gate there; that page is the one unguarded page). A static test fails for a page under `app/(app)` that reaches `apiServer` without it.
- **No token in auth JSON**: the BFF drops `token`/`sessionToken` keys from `/api/auth` JSON bodies (cookies untouched).
- **Browser 401**: `apiBrowser` toasts once and goes to `/api/session/expired` once, however many calls fail together; MFA 401s are the step-up's job.
- **Onboarding**: `completeOnboarding` (server action) creates the company (`POST /v1/tenants`, slug candidates on 409), the deadline, one team per department and the invites, and sets `od-tenant` only after the API confirmed the company. The report-template switches are not saved yet.
- Tests: `lib/session*.test.ts`, `lib/auth-flow.test.ts`, `lib/safe-next.test.ts`, `app/actions/*.test.ts`, `proxy.test.ts`, `test/auth-static.test.ts`, contract `test/contract/auth.test.ts`.

## Mock isolation, e2e and skeleton measurements (B6 T6.9)
**Mock isolation.** `lib/mock-registry.ts` is the only reader of `ENABLE_MOCK_MODULES` and the one list of what may use the JSON reader: `MOCK_DATA_READERS` (every file that imports `lib/data`, with its kind: `mock`, `catalogue` or `display`), `MOCK_ROUTES` (rosters, staff rosters, orders and stock, recruitment, payroll issues, files, manager attention), `MOCK_LOADING_FILES`, `STATIC_LOADING_READERS`, `STATIC_SETTINGS_FILES`. Without the flag: every page under a mock route starts with `const off = mockGate("<module>"); if (off) return off` (`features/shell`, the "Not available yet" state, before any data call); their loading files fall back to the generic skeleton; the nav drops those entries and every badge count (the seed's "Tasks 14" was a mock number); the assistant and the search shortcuts and popular terms of those screens are gone. `test/mock-isolation.test.ts` holds it: the JSON reader is imported only by registry files (and the registry has no stale entry), no route, component or hook names `ME_ID`, `materialiseRecurring`, `mergeIncoming`, `scopeReports` or the seed `isAssigned` filter, no `loading.tsx` outside the mock pages touches a data layer (and only static catalogue readers), every mock page starts with the gate, the nav, layout and actions are filtered, the files I15 named are gone. `/data/**` (including `public/data/settings/*`) is a 404 from `proxy.ts` (smoke checks it).

**E2E (`npm run e2e:stack`, `npm run test:e2e`).** `playwright.config.ts` starts the real API and worker and the web on 3101 and 3100 against `docker-compose.e2e.yml` (Postgres 55432, Redis 56379, MinIO 59000, ClamAV 53310, tmpfs, fake credentials; `api/scripts/e2e-prepare.ts` creates the roles, migrates and makes the bucket). `globalSetup` re-seeds the demo tenants (`ALLOW_DEMO_SEED=1`, the seed refuses anything but a demo-only database), signs every persona in through the BFF into a `storageState`, and builds the shared world (`e2e/world.ts`). One spec per requirement (`cr01`..`cr06`, each signs in through the form once), `walk.spec.ts` (themes, phone, read-only roles, hover, export downloads, the report conflict banner, company switch), and the `skeletons` project (below). `scripts/smoke.mjs` is the HTTP smoke against the same stack (`as`, `tenant`, `mock` per case, the loading skeleton's ghost text ignored); `SMOKE_MOCK=1` runs the mock-only cases against a web started with the flag.

**Skeleton measurements (T6.9 and review round 1, `npm run test:e2e:skeletons`).** The proxy `e2e/slow-api.mjs` sits between the web and the API and holds back only the paths the page itself reads, so the route's `loading.tsx` stays on screen; the page's blocks and total height are measured, then again when the real page arrives (owner view, northgate seed, 1568, 768 and 390 wide). `EXACT` cases must agree within 3px in total and in every block; the rest have a measured `CEILING`.

Exact (skeleton minus loaded, px): dashboard manager 1568 (0.1); shifts week 1568 and 768 (0); task list 1568 (0.1); shift reports inbox 1568 (0.1); billing at 1568, 768 and 390 (1.1, 0.7, 0.7); audit log 1568 (-0.1); console overview at all three widths (0). Fixed in round 1 because the difference was constant: the billing seat field (48 not 44), the invoice empty state (real copy as ghost text), the typical invoice and subscription state (none), the dashboard stat note line (19) and team row lines, the shifts week (footnote and table in one wrapper, a typical week with no-team and two-shift rows), the evidence-tag rows and the Load more button (118 x 48) of the lists; and earlier the `.sk-fsearch` box that wrapped its filter row (`Sk` sets an inline width).

Remaining work (not exact; each has a ceiling in the spec):
- **Data-dependent rows.** Task detail (+210 at 1568: the typical record has more evidence and timeline rows than TSK-1001), report review (-101..+160, a report's rows), account security (+-137, the number of sessions and activity rows), console tenants (+329 at 1568, 1424 at 390) and console audit (-210) (the console draws a typical page of rows, the seed has three tenants).
- **Role (K4).** `loading.tsx` is static and always draws the typical OWNER view: staff dashboard +834, reports +381, shifts +676 at 1568 (recorded, ceilings only). A role-hint cookie (`od-shell`, advisory) would fix it. The support-role console overview height was not measured (needs a second operator with its own TOTP; the overview skeleton assumes the revenue cards).
- **Below 768px.** Tables become stacked cards and rows wrap on real text the ghost bars do not have: dashboard -368/-436, reports inbox -575 at 768, tasks list -172 at 768, audit -239/-232, shifts week +179 at 390, report review. The fix is ghost text from typical rows, as the audit and tasks skeletons already do for the head.
- **Mock placeholder pages** (`MockPageSkeleton` for plans and billing) are only reachable with `ENABLE_MOCK_MODULES=1`; not measured.
- **Location Rosters** (B8 Tasks 20 to 22; shown without `ENABLE_MOCK_MODULES` since Task 23, their `loading.tsx` no longer fall back to `PageSkeleton`): office week, locations list and form and My roster are exact (0 px at 1568 and 390; Task 22 also 768); supervisor and staff views, weeks with change requests or open shifts, and locations with more shift types are CEILING (numbers in `.claude/docs/features/rosters.md` and the Task 20 to 22 reports). Task 25 adds them to the e2e skeleton project.
