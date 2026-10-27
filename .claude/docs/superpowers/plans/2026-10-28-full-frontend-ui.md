# OpsDesk Full Frontend UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build every remaining OpsDesk screen from SRS v1.1 as a working, role-aware, JSON-driven frontend in the OpsDesk theme:
- the 10 sidebar modules and their detail pages
- the staff dashboard
- settings and billing
- the audit log
- sign-in, sign-up and onboarding
- the platform console

**Architecture:**
- Server pages read `public/data/<feature>/*.json` through each feature's `api.ts` and read a mocked session (role and tenant cookies) through `lib/session.ts`.
- Interactive parts are client components. Their state lives in tiny per-feature in-memory stores seeded from props, so a change survives client navigation and resets on reload.
- shadcn gives the behaviour. The look comes from OpsDesk classes in per-feature CSS files.

**Tech Stack:**
- Next.js 16.4 App Router (Turbopack), React 19.3, TypeScript
- shadcn (base-nova / base-ui), `motion/react`, Recharts, sonner, zod
- vitest, added for pure-logic tests

**Spec:** `.claude/docs/superpowers/specs/2026-10-28-full-frontend-ui-design.md`. Read it first. Section refs like §3.3 point to `.claude/docs/requirements/SRS.md`.

## Global Constraints
**Read before any work**
- Read `CLAUDE.md`, `AGENTS.md`, `.claude/docs/architecture.md` and `.claude/docs/00-design-system/ui-rules.md` before writing code. Every task implicitly includes them.

**Next.js**
- This Next.js version differs from training data. Before using an API you're unsure of, read the guide in `node_modules/next/dist/docs/`. Examples: `cookies()`, server actions, `redirect`, route groups, `loading.tsx`, `notFound`.
- If that folder can't be read, use the App Router APIs as documented for Next 15+:
  - `await cookies()` from `next/headers`
  - `"use server"` actions
  - `redirect` from `next/navigation`

**Look and theme**
- OpsDesk look only (ui-rules 1–10): borderless, `--r-lg`, `--r-xl` and `--r-pill` radii, OpsDesk tokens.
- Never use shadcn tokens for anything visible: `bg-popover`, `bg-accent`, `text-muted-foreground` and `ring-*` are banned.
- Hover colour must contrast with the surface behind it.
- Light and dark must both work. In dark, never put `--brand-deep` text on `--brand-soft`.

**Architecture**
- Code goes in `features/<feature>/{components,api.ts,types.ts,index.ts}` and data in `public/data/<feature>/*.json`.
- Features never import other features. Routes compose them.
- Client components never import `api.ts` or the feature `index.ts`.
- Shared code goes in `components/`, `hooks/` and `lib/`.

**Content and accessibility**
- Never hard-code tenant values (company, departments, deadline, timezone, branding, plan names or limits) in components. Read them from JSON.
- Every status shows a text label, never colour alone.
- Every deadline and timestamp shows the tenant timezone label from `getOrg()`.
- Destructive actions open `ConfirmDialog`.
- No horizontal page scroll at 360px width.

**Skeletons**
- Every page and data-driven component has an exact skeleton in `features/<feature>/components/skeletons.tsx`, plus a `loading.tsx` per route.
- Build skeletons with `Sk`/`SkGroup` from `components/sk.tsx`, using the component's own classes.
- There is no browser for implementers. Reuse the `lh` values that `features/dashboard/components/skeletons.tsx` already uses for the same classes (h1, h2, `.sub`, `td`, `.item`). The controller verifies in the browser.

**Motion** (ui-rules → Motion)
- Use the motion tokens.
- `motion/react` only for `layoutId` indicators, list enter/exit (`listItem`), Reorder, CountUp and RollNumber.
- Charts mount their series only when `inView`.
- Reduced motion must be respected.
- No new per-page enter animations.

**CSS**
- Each feature's styles go in `app/styles/<feature>.css`, imported in `app/layout.tsx` after `./opsdesk.css`.
- Never edit another feature's CSS file.
- Shared or kit styles go in `app/styles/kit.css`.

**Mock data**
- The fixed "today" is **2026-10-20** (Tuesday). The timezone is **Europe/London**, label **"UK time"**. The report deadline is **17:30**. All three live in `public/data/shell/org.json`.
- The cast is consistent across features and comes from the existing dashboard JSON:
  - Daniel Okafor, Security Supervisor
  - Grace Mensah, Cleaning Team Lead
  - Priya Shah, HR & Recruitment
  - Tomasz Wójcik, Stock Coordinator
  - Lilianna Novak, Operations Manager, the signed-in default
  - Also the officers M. Haddad, J. Silva and A. Kowalski
  - Clients and sites include Canary Wharf and Riverside House
  - Add more names as needed and reuse them everywhere.
- Mock dates are ISO strings (`2026-10-20T15:00:00`), formatted with `lib/dates.ts`.

**Verification and commits**
- Verification on every task:
  - `npm run typecheck` is clean
  - `npx eslint <changed files>` is clean (ignore the pre-existing `nav-user.tsx:23` setState-in-effect error)
  - `npm test` passes
  - `npm run smoke` passes against the running dev server on :3000
- **No git commits.** The user commits themselves. Replace every "commit" step with "report changed files to the controller".

## Review Focus
1. **Restricted role on a direct URL.** A role without access opens a restricted URL, for example an Employee opening `/payroll-issues` or `/settings`. Expected: the "Access restricted" state, not the page, and no data from that module in the HTML.
   - Owned by Task 3: smoke entries with an employee cookie that expect `Access restricted` and do not expect a payroll reference.
2. **Client-created record opened directly.** A record created client-side is opened by its detail URL, or a bad ref is typed. Expected: a created task opens after client navigation. An unknown ref shows the "not found" empty state, not a crash.
   - Owned by Task 8: a smoke entry for `/tasks/TSK-0000` that expects `Task not found`, plus a store test.
3. **Report submit with gaps.** A report is submitted with a required section untouched, or as a nil report without the explicit nil confirmation. Expected: submit is blocked and each problem is listed with a fix-it message (UAT-07, BR-04).
   - Owned by Task 10: `validateReport` tests.
4. **Read-only role on an editable page.** Auditor, or a suspended tenant, opens an editable page. Expected: no create, edit or decision controls are rendered, and export is still visible (FR-SAAS-08).
   - Owned by Task 3 (`canWrite` helper tests) and Task 7: a smoke entry with an auditor cookie on `/tasks` that does not expect `New task`.
5. **Narrow screen.** Any list page at 360px. Expected: tables turn into stacked cards and there is no horizontal scroll.
   - Owned by Task 5 (`.rtable` CSS). The controller checks it in the browser at each phase end.

---

## File map (new unless marked)
```
vitest.config.ts, scripts/smoke.mjs, scripts/smoke-routes.json
lib/session.ts, lib/permissions.ts(+test), lib/dates.ts(+test), lib/store.ts(+test), lib/org.ts
app/actions/session.ts                       server actions: setRole, setTenant, signIn, signOut
app/styles/{kit,shell,dashboard,tasks,reports,attention,staff-rosters,recruitment,files,payroll,orders,settings,audit,auth,platform}.css
app/layout.tsx (modify: css imports, <Toaster/>)
public/data/shell/{roles,tenants,org,notifications}.json
features/shell (modify): app-shell, nav-user, + subscription-banner, access-restricted, notifications-panel
components/: page-head, status-pill, filter-bar, empty-state, field, confirm-dialog, detail-sheet, when, rtable notes; ui/* via shadcn add
features/dashboard (modify): staff-dashboard-view + public/data/dashboard/staff/*.json
features/tasks, features/reports, features/attention                     (Phase 1)
features/staff-rosters, features/recruitment, features/files, features/payroll, features/orders   (Phase 2)
features/settings, features/billing, features/audit                      (Phase 3)
features/auth, features/platform                                          (Phase 4)
app/(app)/<route>/{page,loading}.tsx per route; app/(auth)/..., app/(platform)/platform/...
```
Feature to route map:
| Feature | Routes |
|---|---|
| tasks | `/tasks`, `/tasks/[ref]` |
| reports | `/daily-reports`, `/daily-reports/[id]` |
| attention | `/manager-attention` |
| staff-rosters | `/staff-rosters` |
| recruitment | `/recruitment` |
| files | `/files` |
| payroll | `/payroll-issues` |
| orders | `/orders-stock` |
| settings | `/settings/[tab]` (and `/settings` redirects to `/settings/organisation`) |
| billing | `/settings/billing` (route composes the feature) |
| audit | `/audit-log` |
| auth | `/sign-in`, `/forgot-password`, `/sign-up`, `/onboarding` |
| platform | `/platform`, `/platform/tenants/[id]`, `/platform/plans`, `/platform/support` |

---

## Phase 0: Foundation

### Task 1: Test harness and smoke runner

**Files:**
- Create: `vitest.config.ts`, `scripts/smoke.mjs`, `scripts/smoke-routes.json`, `lib/dates.ts`, `lib/dates.test.ts`
- Modify: `package.json` (add devDependency `vitest`; scripts `"test": "vitest run"` and `"smoke": "node scripts/smoke.mjs"`)

**Interfaces:**
- Produces: `npm test` and `npm run smoke`.
  - Each entry in `scripts/smoke-routes.json` has the shape `{ "path": string, "status"?: number (default 200), "cookies"?: Record<string,string>, "expect"?: string[], "notExpect"?: string[] }`.
  - The runner fetches `http://localhost:3000` + path with the cookies set and `redirect: "manual"`. It checks the status and checks for substrings in the HTML, prints `PASS`/`FAIL path reason` for each entry, and exits 1 on any failure.
- Produces (`lib/dates.ts`, pure, no imports):
  - `formatDate(iso: string): string` gives `"Tue 20 Oct"`.
  - `formatTime(iso: string): string` gives `"3:00 PM"`.
  - `formatDue(iso: string, today: string): string` gives `"Today 3:00 PM"`, `"Tomorrow 9:00 AM"`, `"Yesterday 5:30 PM"`, or else `"Thu 22 Oct"`.
  - `isOverdue(dueIso: string, nowIso: string): boolean`.
  - `daysBetween(aIso: string, bIso: string): number`, as whole calendar days from b to a.
  - **Treat ISO strings as local wall-clock time.** Parse the components yourself and never use `toLocale*` with the host timezone. That way output is identical on server and client.
- vitest config: `resolve.alias` `@` → project root, `test.include: ["**/*.test.ts"]`, exclude `node_modules`.

- [ ] **Step 1: Write `lib/dates.test.ts`**
  - `formatDue("2026-10-20T15:00:00","2026-10-20T09:00:00") === "Today 3:00 PM"`
  - `formatDue("2026-10-21T09:00:00","2026-10-20T09:00:00") === "Tomorrow 9:00 AM"`
  - `formatDue("2026-10-22T09:00:00","2026-10-20T09:00:00") === "Thu 22 Oct"`
  - `formatDate("2026-10-20T00:00:00") === "Tue 20 Oct"`
  - `formatTime("2026-10-20T17:30:00") === "5:30 PM"`
  - `isOverdue("2026-10-20T12:00:00","2026-10-20T13:00:00") === true`
  - `daysBetween("2026-11-01T00:00:00","2026-10-20T00:00:00") === 12`
- [ ] **Step 2:** `npm i -D vitest`, add the config and scripts, then run `npm test`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `lib/dates.ts`. Run `npm test`. Expected: PASS.
- [ ] **Step 4:** Add the first smoke entry `{ "path": "/", "expect": ["Dashboard"] }`, then run `npm run smoke`. Expected: `PASS /`.

### Task 2: Session, roles, tenants, org context

**Files:**
- Create:
  - `lib/permissions.ts`, `lib/permissions.test.ts`, `lib/session.ts`, `lib/org.ts`, `app/actions/session.ts`
  - `public/data/shell/roles.json`, `public/data/shell/tenants.json`, `public/data/shell/org.json`

**Interfaces:**
- Produces (`lib/permissions.ts`, pure):
  ```ts
  export type Module = "dashboard"|"tasks"|"reports"|"attention"|"staff"|"recruitment"|"files"|"payroll"|"orders"|"settings"|"audit"
  export type Access = "none"|"read"|"write"
  export type Role = { id: string; label: string; description: string; home: "manager"|"staff"; access: Record<Module, Access>; platform?: boolean }
  export function can(role: Role, module: Module, need?: "read"|"write"): boolean   // need defaults to "read"; write implies read
  export function moduleForHref(href: string): Module | null   // "/"→dashboard, "/tasks/…"→tasks, "/daily-reports…"→reports, "/manager-attention"→attention, "/staff-rosters"→staff, "/recruitment", "/files", "/payroll-issues"→payroll, "/orders-stock"→orders, "/settings…"→settings, "/audit-log"→audit, else null
  ```
- `roles.json` is `{ "roles": Role[] }`. It has these ids, labels from SRS §2.3:
  - `owner` (Tenant Owner, home manager, all write)
  - `admin` (Tenant Admin: settings and audit write, others read, payroll none)
  - `manager` (Designated Manager, home manager, all write except settings read and payroll read)
  - `ops` (Operations Manager / Report Owner, home manager)
  - `supervisor` (home staff: tasks, reports and staff write)
  - `employee` (home staff: tasks write, reports read, the rest none)
  - `hr` (home staff: recruitment and files write)
  - `payroll` (home staff: payroll write)
  - `auditor` (home manager: everything read, nothing write)
  - `platform` (Platform Super Admin, `platform: true`, all none)
- `tenants.json` is `{ "tenants": Tenant[] }`, where `Tenant = { id; name; slug; initials; brand: string /* css colour */; status: "trial"|"active"|"past_due"|"suspended"; plan: string; trialEndsOn?: string; graceEndsOn?: string }`.
  - Tenant 1 is the current company. Name it generically, for example "Northgate Facility Services", status active.
  - Tenant 2 is in trial.
  - Tenant 3 is past_due, which demos the banner.
- `org.json` holds `{ "today": "2026-10-20T09:00:00", "timezone": "Europe/London", "tzLabel": "UK time", "deadline": "17:30", "departments": ["Security","Cleaning"] }`.
- `lib/org.ts` exports `getOrg(): Promise<Org>`. It reads `org.json` through `getData` and exports `type Org`.
- `lib/session.ts` (server-only) exports:
  ```ts
  export type Session = { signedIn: boolean; role: Role; tenant: Tenant; roles: Role[]; tenants: Tenant[] }
  export async function getSession(): Promise<Session>
  ```
  - Cookies are `od-role`, `od-tenant` and `od-auth`.
  - Defaults: role `owner`, the first tenant, and signedIn true when `od-auth` is absent, so the existing app still opens.
  - `od-auth=out` means signed out.
- `lib/session.ts` also exports `canWrite(s: Session, m: Module): boolean`. It returns false when the tenant is `suspended` (read-only, FR-SAAS-08). Otherwise it returns `can(role, m, "write")`.
- `app/actions/session.ts` (`"use server"`) exports `setRole(id: string)`, `setTenant(id: string)`, `signIn(roleId?: string)` and `signOut()`:
  - Each sets or clears the cookie.
  - `setRole("platform")` redirects to `/platform`, and any other role revalidates `/`.
  - `signIn` redirects to `/`.
  - `signOut` sets `od-auth=out` and redirects to `/sign-in`.
- Put `Tenant` and `Role` types in `lib/types.ts`. `permissions.ts` imports `Role` from `./types`.

- [ ] **Step 1:** Write `lib/permissions.test.ts`:
  - `can(employee,"payroll")===false`
  - `can(employee,"tasks","write")===true`
  - `can(auditor,"tasks","write")===false`
  - `can(auditor,"tasks")===true`
  - `moduleForHref("/tasks/TSK-1042")==="tasks"`
  - `moduleForHref("/settings/billing")==="settings"`
  - `moduleForHref("/")==="dashboard"`
  - `moduleForHref("/nope")===null`
  - The fixtures are inline Role objects.
- [ ] **Step 2:** `npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement the files above. `npm test`. Expected: PASS. `npm run typecheck` is clean.

### Task 3: Role- and tenant-aware shell

**Files:**
- Modify: `app/(app)/layout.tsx`, `features/shell/components/app-shell.tsx`, `features/shell/components/nav-user.tsx`, `features/shell/components/skeletons.tsx`, `features/shell/index.ts`, `features/shell/types.ts`, `app/layout.tsx`
- Create: `features/shell/components/subscription-banner.tsx`, `features/shell/components/access-restricted.tsx`, `app/styles/shell.css`, `app/styles/kit.css` (empty header comment for now)

**Interfaces:**
- Consumes: `getSession`, `can`, `moduleForHref`, `setRole`, `setTenant`, `signOut` (Task 2).
- `AppShell` gets new props `session: { role: Role; roles: Role[]; tenant: Tenant; tenants: Tenant[] }`:
  - Nav items are filtered with `can(role, moduleForHref(href) ?? "dashboard")`.
  - If the user's display role differs from `user.role`, show the role label from `session.role.label` under the name.
- `NavUser`:
  - Add a "View as (preview)" submenu that lists the roles with a check on the current one. It calls `setRole`.
  - Add a "Switch company" submenu over the tenants. It calls `setTenant`.
  - Wire "Settings" to `/settings` and "Log out" to `signOut`.
  - Mark the submenu visibly as a demo preview: label `View as (preview)`.
- `SubscriptionBanner({ tenant, tzLabel })` renders inside `.canvas` above the children:
  - trial: "Trial ends {date}", with a link to `/settings/billing`
  - past_due: "Payment failed. Update billing by {graceEndsOn} to keep full access."
  - suspended: "Read-only: subscription inactive. You can still export data."
  - active: nothing.
- `AccessRestricted({ moduleLabel })` is the page body with heading "Access restricted". It says "Your role doesn't include {moduleLabel}. This attempt has been logged." and links to the dashboard. It uses `.card soon`-style layout classes.
- Export from `features/shell/index.ts`: `AccessRestricted`, `SubscriptionBanner`.
- Pattern every gated route page uses (copy exactly):
  ```tsx
  const s = await getSession()
  if (!can(s.role, "payroll")) return <AccessRestricted moduleLabel="Payroll Issues" />
  ```
- `app/layout.tsx`: import `./styles/shell.css` and `./styles/kit.css` after `./opsdesk.css`.

- [ ] **Step 1:** Add smoke entries:
  - `/` with cookie `od-role=employee` and `notExpect: ["Payroll Issues"]`. The sidebar label must be gone.
  - `/` with `od-tenant` set to tenant 3's id and `expect: ["Payment failed"]`.
- [ ] **Step 2:** `npm run smoke`. Expected: both FAIL.
- [ ] **Step 3:** Implement. `npm run smoke`, typecheck and eslint. Expected: PASS.
  - With no cookies, `/` must look exactly as before: same nav, no banner.

### Task 4: Notifications panel

**Files:**
- Create: `public/data/shell/notifications.json`, `features/shell/components/notifications-panel.tsx`
- Modify: `features/shell/api.ts` (`getNotifications`), `features/shell/types.ts`, `app/(app)/layout.tsx`, `app-shell.tsx` (bell opens panel), `app/styles/shell.css`

**Interfaces:**
- `Notification = { id; type: "assigned"|"reassigned"|"deadline"|"evidence"|"report-returned"|"manager-action"|"reminder"; title: string; at: string; read: boolean; href: string }`.
  - Titles must not contain sensitive details (FR-NOT-04). For example "A payroll issue was assigned to you", never names or amounts.
- The panel is a shadcn `Popover`, or the `Sheet` on mobile, re-skinned like `.od-menu`. It contains:
  - tabs All and Unread
  - "Mark all read"
  - each row: icon, title, `formatDue(at)` and the tz label
  - The bell dot count comes from unread in client state.
- The skeleton isn't needed: the panel is client-only and opens after load.

- [ ] **Step 1:** Implement, with 10 notifications covering every type.
- [ ] **Step 2:** typecheck, eslint and smoke (`/` still PASS).

### Task 5: Shared UI kit

**Files:**
- Run: `npx shadcn@latest add popover textarea radio-group switch accordion alert-dialog calendar progress scroll-area command`. Only add the ones missing from `components/ui/`. If the CLI asks to overwrite existing files, answer no.
- Create: `components/page-head.tsx`, `components/status-pill.tsx`, `components/filter-bar.tsx`, `components/empty-state.tsx`, `components/field.tsx`, `components/confirm-dialog.tsx`, `components/detail-sheet.tsx`, `components/when.tsx`, `lib/store.ts`, `lib/store.test.ts`
- Modify: `app/styles/kit.css`, `app/layout.tsx` (mount a re-skinned sonner `<Toaster/>`, class `.od-toast`), `.claude/docs/architecture.md` (list the kit and `app/styles/`, and update rule 8: per-feature CSS now lives in `app/styles/<feature>.css`)

**Interfaces (all later tasks use these; don't fork them):**
```ts
// lib/store.ts: per-feature in-memory store; survives client navigation, resets on reload
export function createStore<T>(): {
  useStore(seed: T): readonly [T, (update: (prev: T) => T) => void]   // seeds once (first call), then ignores seed
  get(): T | undefined
  reset(): void   // tests only
}
// components/page-head.tsx  (uses existing .head/.head-actions classes)
export function PageHead(props: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }): JSX.Element
export function PageHeadSkeleton(props: { actions?: number }): JSX.Element
// components/status-pill.tsx (existing .st + tone classes; text label always)
export function StatusPill(props: { status: Status }): JSX.Element
// components/filter-bar.tsx  (.od-filters row; wraps on mobile)
export function FilterBar(props: { children: React.ReactNode }): JSX.Element
export function FilterSearch(props: { value: string; onChange(v: string): void; placeholder: string }): JSX.Element
export function FilterSelect<V extends string>(props: { label: string; value: V; options: { value: V; label: string }[]; onChange(v: V): void }): JSX.Element // shadcn Select, re-skinned
export function FilterSeg<V extends string>(props: { label: string; value: V; options: { value: V; label: string }[]; onChange(v: V): void }): JSX.Element // .seg pill group with layoutId indicator (unique layoutId per instance via useId)
// components/empty-state.tsx
export function EmptyState(props: { icon: string; title: string; text?: string; action?: React.ReactNode }): JSX.Element
// components/field.tsx: label + control + hint/error (aria-describedby, aria-invalid)
export function Field(props: { label: string; htmlFor: string; error?: string; hint?: string; required?: boolean; children: React.ReactNode }): JSX.Element
// components/confirm-dialog.tsx: shadcn AlertDialog re-skinned (.od-dialog)
export function ConfirmDialog(props: { open: boolean; onOpenChange(o: boolean): void; title: string; text: string; confirmLabel: string; destructive?: boolean; onConfirm(): void }): JSX.Element
// components/detail-sheet.tsx: shadcn Sheet from right (bottom on ≤720px), re-skinned like .ai-panel
export function DetailSheet(props: { open: boolean; onOpenChange(o: boolean): void; title: string; subtitle?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }): JSX.Element
// components/when.tsx: formatted date/time + tz label, e.g. "Today 3:00 PM UK time"
export function When(props: { iso: string; today: string; tzLabel: string; mode?: "due" | "date" | "time" }): JSX.Element
```

**CSS in `kit.css`:**
- `.od-filters`
- `.od-dialog`, which extends the existing `.day-dialog` look
- `.od-sheet`
- `.od-field` (inputs, selects and textarea get `--mute-bg` fill, no border, `--r-md`, brand focus)
- `.od-toast`
- `.od-empty`
- **`.rtable`**: on a `<table>`, at max-width 720px rows become stacked cards and each `td` shows its `data-label` as a small caption. Use it on every list table from here on.
- Re-skin every newly added shadcn primitive per ui-rules rules 1–5.

**Tests:**
- [ ] **Step 1:** `lib/store.test.ts`:
  - Calling `useStore` via `renderHook` is not available, so test the non-hook core instead. Expose `createStore` internals by calling `get()` after a seed through an exported `seed(value)` helper, or test with `useSyncExternalStore` through `react-dom/server` `renderToString`.
  - Required assertions: after the first seed, `get()` returns the seed; a second seed is ignored; an update function produces the new value; `reset()` clears it.
  - Add `seed(value: T): void` to the interface if you choose the helper.
- [ ] **Step 2:** `npm test`. Expected: FAIL, then implement, then PASS.
- [ ] **Step 3:** typecheck and eslint. `/` smoke still PASS.

---

## Phase 1: Core

### Task 6: Staff dashboard (SRS §10.1)

**Files:**
- Create:
  - `public/data/dashboard/staff/{header,my-tasks,evidence,report,comments}.json`
  - `features/dashboard/components/staff-dashboard-view.tsx` and its widget components
  - additions to `skeletons.tsx`
  - `app/styles/dashboard.css`
- Modify: `features/dashboard/api.ts` (`getStaffDashboard()`), `index.ts`, `app/(app)/page.tsx`, `app/(app)/loading.tsx`

**Interfaces:**
- `/` shows `<StaffDashboardView data={await getStaffDashboard()} session-derived props/>` when `session.role.home === "staff"`, and the existing dashboard otherwise.
- The data is "me" = Daniel Okafor, Security Supervisor, for any staff-home role.
- Widgets:
  - stat row, reusing `.stat` and CountUp: My open, Overdue/blocked, Awaiting review, Returned to me
  - "My tasks" list with due date (`When`) and StatusPill, linking to `/tasks/[ref]`
  - "Evidence" list showing awaiting review or returned with the reviewer's reason
  - "Today's report" card. It reuses the existing deadline countdown look (`RollNumber`) and only renders when `report.owner === true`.
  - "Recent submissions and manager comments" list
- Copy the visual grid of the existing dashboard (`.grid` and similar classes in `opsdesk.css`).
- `loading.tsx` must pick the matching skeleton. Make it `async`, read `getSession()`, and return `StaffDashboardSkeleton` or `DashboardSkeleton`. If Next forbids cookies in `loading.tsx` (check the docs), fall back to `DashboardSkeleton` and note it in the report.

- [ ] **Step 1:** Smoke: `/` with `od-role=employee` expects `My tasks` and does not expect `Team Tasks`. `/` with no cookie still expects `Team Tasks`. Run it. Expected: FAIL.
- [ ] **Step 2:** Implement. Smoke, typecheck and eslint. Expected: PASS.

### Task 7: Tasks: data, lifecycle, list page (SRS §3.3)

**Files:**
- Create:
  - `public/data/tasks/tasks.json`, `public/data/tasks/people.json`
  - `features/tasks/{types.ts,api.ts,index.ts,lifecycle.ts,lifecycle.test.ts,store.ts}`
  - `features/tasks/components/{tasks-view.tsx,task-table.tsx,new-task-dialog.tsx,skeletons.tsx}`
  - `app/(app)/tasks/{page,loading}.tsx`, `app/styles/tasks.css`

**Interfaces:**
```ts
export type TaskStatus = "not_started"|"in_progress"|"blocked"|"submitted"|"changes_requested"|"completed"|"cancelled"
export const STATUS: Record<TaskStatus, Status>   // labels exactly FR-TASK-02: Not Started, In Progress, Blocked, Submitted for Review, Changes Requested, Completed, Cancelled
export type Person = { id: string; name: string; role: string; initials: string; avatar: "av1"|"av2"|"av3"|"av4"; dept: string }
export type Evidence = { id: string; kind: "image"|"file"|"link"|"note"; name: string; by: string; at: string; review: "pending"|"accepted"|"rejected"|"info_requested"; reason?: string }
export type TimelineEvent = { at: string; by: string; text: string }
export type Task = { ref: string; title: string; description: string; dept: string; assignee: string /*Person.id*/; creator: string; priority: 1|2|3; start: string; due: string;
  status: TaskStatus; evidenceRequired: boolean; client?: string; tags: string[]; submittedAt?: string; completedAt?: string;
  notes: TimelineEvent[]; evidence: Evidence[]; timeline: TimelineEvent[]; overdue?: { reason: string; nextAction: string; owner: string; revisedDue: string } }
// lifecycle.ts (pure)
export function nextStatuses(t: Task, actor: "assignee"|"reviewer"): TaskStatus[]
//   assignee: not_started→in_progress|blocked; in_progress→blocked|submitted; blocked→in_progress; changes_requested→in_progress|submitted
//   reviewer (manager write): submitted→completed|changes_requested; any open→cancelled; completed/cancelled→[]
//   submitted is allowed only when !evidenceRequired || evidence.length>0 (FR-TASK-05)
export function canComplete(t: Task): boolean          // BR-05: evidenceRequired ⇒ every evidence accepted and ≥1
export function isLate(t: Task, nowIso: string): boolean  // FR-TASK-08: compares (submittedAt ?? completedAt ?? now) with due
// store.ts
export const tasksStore = createStore<Task[]>()
```

**Data (`tasks.json`):**
- `{ tasks: Task[] }` with **60 tasks**.
- Exactly **48 open**, meaning not completed or cancelled. Of those, **7 overdue** (3 of them `blocked`) and **9 `submitted`**. These match the dashboard stats.
- It includes the 5 refs and titles from `public/data/dashboard/team-tasks.json`, unchanged.
- `people.json` is `{ people: Person[] }` and holds the cast.

**Page (`TasksView`, client):**
- `PageHead` "Tasks". The "New task" button shows only if `canWrite(session,"tasks")`. Pass the result as `canCreate` from the page.
- Filters: `FilterSearch`, plus status, priority, assignee and due (`all|today|overdue|week`) as `FilterSelect`/`FilterSeg`. Department comes from the global `useDept()`.
- The table is `.rtable` with columns Task (title and ref), Assignee, Dept, Priority (the existing `.prio`), Due (`When`, plus "late" when `isLate`) and Status. Rows use AnimatePresence and `listItem`. A row links to `/tasks/[ref]`.
- The empty state shows when the filters match nothing.
- An employee sees only their own tasks: the page filters the seed to assignee "me" when `role.home==="staff"` before passing it.
- `NewTaskDialog`:
  - The fields are exactly FR-TASK-01: title, description, department (from `org.departments`), assignee, priority, start date, due date and time, optional client, evidence required, tags.
  - zod validation runs through `Field`.
  - On save it prepends to the store with the next ref (`TSK-` + max+1), adds a timeline "Created by …" entry, and shows the toast "Task TSK-1061 created".

- [ ] **Step 1:** `lifecycle.test.ts`:
  - From `in_progress` an assignee can reach submitted only if the evidence condition holds.
  - A reviewer on `submitted` gets `["completed","changes_requested","cancelled"]`.
  - `canComplete` is false with any rejected evidence.
  - `isLate` is true when submittedAt > due.
  - Run it. Expected: FAIL.
- [ ] **Step 2:** Smoke:
  - `/tasks` expects `Tasks` and `TSK-1042`.
  - `/tasks` with `od-role=auditor` does not expect `New task`.
  - `/tasks` with `od-role=employee` does not expect `TSK-1038` (that is Grace's task).
- [ ] **Step 3:** Implement. Tests, smoke, typecheck and eslint. Expected: PASS.

### Task 8: Task detail `/tasks/[ref]`

**Files:**
- Create: `features/tasks/components/{task-detail.tsx,task-actions.tsx,evidence-panel.tsx,overdue-form.tsx,task-timeline.tsx}`, `app/(app)/tasks/[ref]/{page,loading}.tsx`
- Add to: `skeletons.tsx`, `lib/store.test.ts`, or `features/tasks/lifecycle.test.ts`

**Interfaces:**
- Consumes: `tasksStore`, `nextStatuses`, `canComplete`, `isLate`, `STATUS`.
- The page passes all tasks as the seed, plus `ref`, `people`, `org` and `actor`:
  - `actor` is "reviewer" when `canWrite(tasks)` and `role.home==="manager"`, otherwise "assignee".
- `TaskDetail` finds the ref in the store. If it's missing, it shows `EmptyState` with title "Task not found" and a link back.

**Layout:**
- **Main card:** title, ref, StatusPill, priority, dept, assignee, creator, start and due (`When`), client, tags, description, and an on-time or late badge.
- **Actions:** one button per `nextStatuses` result. `cancelled` goes through `ConfirmDialog`. "Mark completed" is disabled with a hint when `!canComplete`.
- **Evidence panel:**
  - An upload drop zone that adds a pending item locally. It shows a fake progress bar using `.progress` (FR-MOB-05). It is not a real upload.
  - Add link, add note.
  - A reviewer can accept, reject (dialog, reason required), or request info (dialog, message required) on each item.
- **Progress notes:** a textarea that adds to the notes.
- **Overdue block** (when overdue and open): fields reason, next action, responsible person and revised due date (FR-TASK-09).
- **Timeline:** every change appends `{at: org.today-based now, by: current user, text}`, for example "Status changed In Progress → Submitted for Review" or "Deadline changed …" (FR-TASK-04).
- **Wording:** the UI states "Submitted for review: waiting for reviewer approval" distinctly from "Completed" (FR-TASK-12).

- [ ] **Step 1:** Smoke:
  - `/tasks/TSK-1042` expects `Patrol log check` and `Timeline`.
  - `/tasks/TSK-0000` expects `Task not found`. The status is 200, because client lookup does the not-found. That's acceptable; document it.
- [ ] **Step 2:** Implement. Smoke, typecheck and eslint. Expected: PASS.

### Task 9: Daily reports: data, lifecycle, list/board page (SRS §3.4–3.5, §4, §10.3)

**Files:**
- Create:
  - `public/data/reports/{template,reports}.json`
  - `features/reports/{types,api,index,lifecycle,lifecycle.test,store}.ts`
  - `features/reports/components/{reports-view,submission-board,review-queue,report-history,today-report-card,skeletons}.tsx`
  - `app/(app)/daily-reports/{page,loading}.tsx`, `app/styles/reports.css`

**Interfaces:**
```ts
export type ReportStatus = "draft"|"submitted"|"returned"|"resubmitted"|"reviewed"|"overdue"   // labels per §4.2: Draft, Submitted, Returned for Correction, Resubmitted, Reviewed, Overdue
export type FieldState = "no_issues"|"action_required"|"na"|"details"           // labels: No issues, Action required, Not applicable, Details provided
export type TemplateField = { id: string; label: string; required: boolean; entry: "text"|"count"|"structured"; columns?: string[] }
export type TemplateSection = { id: string; n: number; title: string; restricted?: boolean; fields: TemplateField[] }
export type ReportEntry = { id: string; text: string; cells?: Record<string,string> }
export type ReportField = { state?: FieldState; entries: ReportEntry[] }
export type ReportVersion = { v: number; at: string; by: string; note: string }
export type Report = { id: string; date: string; dept: string; owner: string; status: ReportStatus; createdAt: string; updatedAt: string; submittedAt?: string;
  nil: boolean; fields: Record<string /*sectionId.fieldId*/, ReportField>; comments: { at: string; by: string; text: string; section?: string }[]; versions: ReportVersion[] }
export const REPORT_STATUS: Record<ReportStatus, Status>
export function reportTransitions(s: ReportStatus, actor: "owner"|"reviewer"): ReportStatus[]  // §4.2 table exactly
export function validateReport(r: Report, t: TemplateSection[]): { key: string; section: string; message: string }[]
//   nil report: valid only when r.nil===true and every required field has state "no_issues" or "na" → else message "Confirm each section has no issues, or add details"
//   non-nil: each required field needs a state; state "details"|"action_required" needs ≥1 entry → message "Add at least one entry or mark No issues"
export function reportProgress(r: Report, t: TemplateSection[]): { done: number; total: number }  // fields with a state
export function isLateSubmission(r: Report, deadline: string /*"17:30"*/): boolean  // BR-02
```

**Data:**
- `template.json` holds the 10 sections and their fields exactly as in SRS §4: the section titles and the field names in the "Fields to capture" column. Payroll has `restricted: true`.
- `reports.json` covers 14 days back from 2026-10-20 for the 2 departments.
  - Today: Security is `submitted` at 16:52, and Cleaning is `draft`. This matches the dashboard "1/2".
  - Mix in `reviewed`, `returned` (with comments), `resubmitted` and `overdue` across the earlier days.
  - At least one report has 2 versions.

**Page:**
- If the role can write reports and `home==="manager"`:
  - `SubmissionBoard`: today, per department and owner, showing the status and time with tz.
  - `ReviewQueue`: submitted and resubmitted reports, linking to `/daily-reports/[id]`.
  - `ReportHistory`: `.rtable` with filters for date range, department (global), owner and status. It has an "Export CSV" button that shows the toast "Export logged" (FR-AUD-05).
- Staff-home roles get `TodayReportCard` for their own department's report. It shows the deadline with `RollNumber` and an "Open report" button. Below it is their own history.

- [ ] **Step 1:** `lifecycle.test.ts`:
  - `reportTransitions("submitted","reviewer")` deep-equals `["reviewed","returned"]`.
  - `reportTransitions("returned","owner")` includes `"resubmitted"`.
  - `validateReport` on an empty non-nil report returns one error per required field.
  - On a nil report with all states "no_issues" it returns `[]`.
  - On a nil report with one field "details" and no entry it returns ≥1 error.
  - `isLateSubmission` with submittedAt 17:31 is true.
  - Run it. Expected: FAIL.
- [ ] **Step 2:** Smoke:
  - `/daily-reports` expects `Review queue` and `Security`.
  - With `od-role=employee` it expects `Today` and does not expect `Review queue`.
- [ ] **Step 3:** Implement. Tests, smoke, typecheck and eslint. Expected: PASS.

### Task 10: Report form `/daily-reports/[id]` (edit mode)

**Files:**
- Create: `features/reports/components/{report-form.tsx,report-section.tsx,field-entries.tsx,report-progress.tsx}`, `app/(app)/daily-reports/[id]/{page,loading}.tsx`

**Interfaces:**
- Consumes: Task 9 types, `validateReport`, `reportProgress`, `reportsStore`.
- The page passes `{ id, seed: reports, template, org, mode }`:
  - `mode` is `"edit"` when the role can write reports and the status is `draft|returned`, otherwise `"review"`. `"review"` is built in Task 11; render a placeholder until then.
  - An unknown id shows `EmptyState` "Report not found".

**Form:**
- **Header** (§4): date, department, owner, status, created/updated/submitted times with the tz label, and the deadline "5:30 PM UK time" taken from `org.deadline`.
- **Sticky progress** `done/total`, using `.progress` and the fill animation, plus a "Needs attention" list of links to sections.
- **10 sections** in shadcn `Accordion` (collapsible, per §5.2 mobile).
- **Each field:**
  - a `RadioGroup` of the 4 states
  - the entries list when the state is details or action_required: add, edit, remove entry, with "structured" fields showing their columns
  - Payroll is hidden unless the role can read payroll. In that case show "Restricted section", and validation skips it.
- **"Nil / clear report"** switch at the top. Turning it on requires confirming via `ConfirmDialog` and sets every state to `no_issues` (BR-04).
- **Buttons:**
  - "Save draft": updates `updatedAt` and shows the toast "Draft saved".
  - "Submit": runs `validateReport`. If there are errors, it expands those sections, shows the errors under each field via `Field`, and posts an error summary at the top. Otherwise it sets `submitted` (or `resubmitted` if it was returned) with `submittedAt`, adds a version entry, and redirects to `/daily-reports` with the toast "Report submitted 4:52 PM UK time".

- [ ] **Step 1:** Add `validateReport` cases for a restricted section skipped (pass `skip: string[]`, extending the signature to `validateReport(r, t, skip?: string[])`). Run it. Expected: FAIL, then implement, then PASS.
- [ ] **Step 2:** Smoke: the today Cleaning draft id expects `Staff / Attendance`, `Manager Attention Required` and `Save draft`.
- [ ] **Step 3:** Implement. Smoke, typecheck and eslint. Expected: PASS.

### Task 11: Report review mode and history

**Files:**
- Create: `features/reports/components/{report-review.tsx,version-history.tsx,follow-up-dialog.tsx}`
- Modify: the `[id]` page and form switch.

**Review mode:**
- Read-only sections and entries, with section comments: add a comment on a section.
- "Accept" (→ reviewed) and "Return for correction", which requires a comment (FR-REP-09).
- "Assign follow-up task" dialog: title, assignee, due date. It shows the toast "Follow-up TSK-… created" (FR-REV-02). It does NOT write to the tasks store, because features don't import each other.
- **Version history** list (FR-REP-10): the original submission time is shown and never changed.
- **Print and export:**
  - "Print": `window.print()` plus a print stylesheet in `reports.css` that hides the shell.
  - "Export PDF" and "Export CSV": toast "Export logged · v{n} · generated {time}" (§10.3).
- Owners viewing a submitted report get the same read-only view without the review buttons.

- [ ] **Step 1:** Smoke: today's Security report id expects `Accept` and `Return for correction` (default owner role). With `od-role=employee` it does not expect `Accept`.
- [ ] **Step 2:** Implement. Smoke, typecheck and eslint. Expected: PASS.

### Task 12: Manager Attention `/manager-attention` (SRS §3.5, §3.14)

**Files:**
- Create: `public/data/attention/{items,outstanding}.json`, `features/attention/{types,api,index,store}.ts`, `features/attention/components/{attention-view,attention-list,decision-dialog,outstanding-list,skeletons}.tsx`, `app/(app)/manager-attention/{page,loading}.tsx`, `app/styles/attention.css`

**Interfaces:**
```ts
export type AttentionItem = { id: string; title: string; summary: string; impact: string; urgency: "low"|"medium"|"high"|"critical"; decision: string /*requested decision*/;
  owner: string; due: string; dept: string; status: "open"|"decided"|"in_progress"|"resolved"; source: "report"|"task"|"client"|"staff"|"roster"|"stock";
  history: { at: string; by: string; action: string; note?: string }[]; decisionRecord?: { by: string; at: string; outcome: "approved"|"rejected"|"deferred"; note: string } }
export type OutstandingItem = { id: string; title: string; reason: string; owner: string; priority: 1|2|3; nextAction: string; target: string; carriedFrom: string; status: "open"|"closed"; resolution?: string }
```

**Data:**
- The 4 open items match the 4 titles in `dashboard/manager-attention.json` (sidebar badge 4).
- Add 8 decided or resolved items for history.
- Add 10 outstanding items, some carried 3+ days.

**Page:**
- Seg filter: Open, Decided, All.
- List sorted by urgency then due. Each row shows urgency as a text pill, summary, requested decision, owner, due (`When`) and status.
- Clicking a row opens a `DetailSheet` with the full fields and history.
- `DecisionDialog`: outcome radio and a required note. It records `decisionRecord` with the current user and time (FR-REV-05) and appends history.
- "Outstanding (carried forward)" section: each item can be updated or closed. Closing requires a resolution note (FR-OUT-05).
- Drag reorder is only on the dashboard, so don't add it here.
- Gate: `can(role,"attention")`. The decision buttons need `canWrite`.

- [ ] **Step 1:** Smoke:
  - It expects `Approve overtime for Canary Wharf night cover` and `Outstanding`.
  - With `od-role=employee` it expects `Access restricted`.
- [ ] **Step 2:** Implement. Smoke, typecheck and eslint. Expected: PASS.

---

## Phase 2: Operations modules
Each task in this phase has the same shape. The steps are identical: smoke first (expect the page heading and one seeded row; a forbidden role expects `Access restricted`), then implement, then smoke, typecheck and eslint.
- **Shape:**
  - `public/data/<feature>/*.json` with 12–25 rows
  - `features/<feature>/{types,api,index,store}.ts`
  - components with a view, a list (`.rtable`), a `DetailSheet` and an add/edit dialog (zod plus `Field`), plus skeletons
  - `app/(app)/<route>/{page,loading}.tsx` and `app/styles/<feature>.css`
- **Page:**
  - `PageHead` with a stat row (`.stat` and `CountUp`)
  - `FilterBar`
  - the global department filter applied
  - `EmptyState` when nothing matches
  - create and edit buttons only when `canWrite`
  - every change appends to the record's history and shows a toast

### Task 13: Staff & Rosters `/staff-rosters` (feature `staff-rosters`, gate `staff`)
- **Data:**
  - `incidents.json`: type `callout|noshow|cover|staff_issue`, staff, shift, site/client, cover person, status, owner, action, history. FR-STAFF-01/02/04.
  - `roster-gaps.json`: when `today|tomorrow|next_week`, shift date and time, site, role, assigned staff, coverage `covered|partial|uncovered`, owner, next action, notes. FR-ROSTER-02/03.
  - The counts match `dashboard/coverage.json`, for example the uncovered shifts tomorrow.
- **UI:** tabs Attendance and Roster gaps. Roster gaps are grouped Today, Tomorrow, Next week.
- Sensitive staff fields (contact, notes) are rendered only when `can(role,"staff","write")`. Otherwise they show "Restricted" (FR-STAFF-03).
- Smoke expects `Roster gaps`.

### Task 14: Recruitment `/recruitment` (feature `recruitment`, gate `recruitment`)
- **Data:** `candidates.json` with name, contact, role applied, stage `applied|reviewed|contacted|interview|offer|starter|rejected`, last contact, next action, owner, dept, history.
- **UI:**
  - a seg toggle for Pipeline and List
  - Pipeline is horizontal columns that scroll inside the card on mobile, never the page
  - a stage change goes through a select in the sheet
  - the counts row matches §3.9: reviewed, contacted, interviews, new starters, outstanding
- Contact details are only shown with write access (FR-REC-03).
- Smoke expects `Pipeline`.

### Task 15: Employee & Client Files `/files` (feature `files`, gate `files`)
- **Data:**
  - `employee-docs.json`: type (SIA licence, Right to work, DBS…), staff, received, expiry, status `valid|expiring|expired|missing|unverified`, storage ref, confirmedBy.
  - `client-files.json`: client, site, contacts, contract ref, document status, outstanding paperwork.
  - The dashboard's 3 expiring docs must appear.
- **UI:**
  - Tabs: Employee documents, Client files.
  - Expiry shows "in N days" using `daysBetween`.
  - The "Confirm valid" action only appears for `unverified` (FR-EFILE-05).
  - "Open file" shows the toast "Secure link opened · access logged" (FR-CFILE-03).
- Smoke expects `SIA licence`.

### Task 16: Payroll Issues `/payroll-issues` (feature `payroll`, gate `payroll`)
- **Data:** `issues.json` with reference `PAY-…`, staff, type `missed_hours|overtime|deduction|bank_details|other`, description, owner, target date, status `open|info_needed|correction_required|resolved`, resolution, history.
- **UI:**
  - A banner: "Issue tracking only: no payroll calculation" (FR-PAY-02).
  - Resolve requires a resolution note.
- Smoke: the default role expects `PAY-`. `od-role=employee` expects `Access restricted` and does not expect `PAY-`.

### Task 17: Orders & Stock `/orders-stock` (feature `orders`, gate `orders`)
- **Data:** `orders.json` with item, qty, supplier, reference, requester, dept, approval `pending|approved|rejected`, expected date, delivery `not_ordered|ordered|partial|delivered`, amount (GBP number, formatted `£640`), history.
  - The "Supplies order £640" pending item must be present.
- **UI:**
  - Tabs: Waiting approval, Orders, Deliveries.
  - Approvers (`canWrite`) get Approve and Reject; reject requires a reason (FR-STOCK-03).
  - "Mark delivered" with a received quantity.
- Smoke expects `Waiting approval`.

---

## Phase 3: Admin, billing and audit

### Task 18: Settings shell plus Organisation, Departments, Users & invites, Roles
**Files:**
- `public/data/settings/{organisation,departments,users,invites,roles-matrix}.json`
- `features/settings/...`
- `app/(app)/settings/page.tsx` (redirects to `/settings/organisation`)
- `app/(app)/settings/[tab]/{page,loading}.tsx` with `generateStaticParams` over the tab ids
- `app/styles/settings.css`

**Interfaces:**
- `SETTINGS_TABS = [{id:"organisation"},{id:"departments"},{id:"users"},{id:"roles"},{id:"template"},{id:"notifications"},{id:"integrations"},{id:"branding"},{id:"billing"},{id:"privacy"}]`, each with `label` and `icon`.
- `SettingsLayout({ tab, children })` puts a left tab list (horizontal scroll pills on mobile) next to the content.
- Gate: `can(role,"settings")`. Editing needs `canWrite`.
- The `billing` tab is rendered by the route composing `features/billing` (Task 19).
- The `template`, `notifications`, `integrations`, `branding` and `privacy` tabs render a placeholder until Task 19.

**Tabs:**
- **Organisation:**
  - company name, subdomain `{slug}.opsdesk.app`, timezone (select)
  - report deadline (time) and weekend/holiday rule (radio)
  - session timeout (FR-AUTH-07)
  - Save shows a toast.
- **Departments, sites and teams** (FR-ORG-02):
  - Security and Cleaning are seeded and can be renamed, added or deactivated.
  - Each department has sites, teams and a report owner.
- **Users and invites:**
  - The user table shows name, email, role, department, status and last active, with deactivate/reactivate behind `ConfirmDialog`.
  - The Invite dialog takes email, role and department (FR-SAAS-05).
  - The invites list shows expiry with Resend and Revoke.
  - A plan seat-limit message appears when the seats are full (FR-SAAS-06).
- **Roles:** a permission matrix (modules × roles, `none/read/write` select) from `roles-matrix.json`, with the note "Changes are audited".

**Steps:**
- [ ] **Step 1:** Smoke:
  - `/settings/organisation` expects `Report deadline`
  - `/settings/users` expects `Invite`
  - `/settings/users` with `od-role=employee` expects `Access restricted`
- [ ] **Step 2:** Implement. Smoke, typecheck and eslint. Expected: PASS.

### Task 19: Remaining settings tabs plus billing feature
**Files:**
- `public/data/settings/{template,notifications,integrations,branding,privacy}.json`
- `public/data/billing/{plans,subscription,invoices,usage}.json`
- `features/billing/...`

**Settings tabs:**
- **Report template:** per-department section list showing which sections are enabled, with field required toggles (FR-ORG-04, NFR-MAINT-01).
- **Notifications:**
  - reminder intervals before the deadline, e.g. 60/30/10 min chips
  - channels (in-app, email, WhatsApp) per event type
  - the "Hide sensitive details in previews" switch, locked on (FR-NOT-02/04)
- **Integrations** (§9): cards for Google Drive, WhatsApp Business, Email sender and Transcription.
  - Each has a status (`connected|not_connected|error`), a connect or disconnect button, the last event with its time, and a policy note.
  - Drive shows "Office PCs only · blocked on Android" (FR-GDR-02/03).
- **Branding:** name, logo (upload preview) and brand colour, with a live preview of the sidebar logo chip (FR-SAAS-11).
- **Data and privacy:**
  - "Export all data" (progress, then toast)
  - "Request deletion" (ConfirmDialog, typing the company name)
  - support access grants listed with expiry and revoke, plus "Grant 24h access" (FR-SAAS-10/15)

**Billing** (`features/billing`, FR-SAAS-06/07/07a):
- the current plan and status (`StatusPill`)
- the renewal date
- usage against limits (active users, storage, messages, transcription minutes) with `.progress` bars
- a plans grid where the current plan is highlighted
- "Change plan" and "Manage billing" buttons, which show a toast "Opening {provider} checkout…" or "Opening {provider} billing portal…", where `provider` comes from `subscription.json` `"provider": "Stripe"`
- an invoices table showing number, date, amount, status and a download toast
- the payment-failed state when the tenant status is `past_due`

**Steps:**
- [ ] **Step 1:** Smoke:
  - `/settings/billing` expects `Manage billing` and `Invoices`
  - `/settings/integrations` expects `Google Drive`
- [ ] **Step 2:** Implement. Smoke, typecheck and eslint. Expected: PASS.

### Task 20: Audit Log `/audit-log` (feature `audit`, gate `audit`)
- **Data:** `events.json` with 60 events: actor, action (sign-in, failed sign-in, role change, deactivation, export, status change, report submitted/reviewed/returned, decision, invite, billing), record type and ref, time, IP and device, and a `sensitive` flag. FR-AUTH-06, FR-AUD-02.
- **UI:**
  - Filters: search, actor, action, record type, date range.
  - A table with an expandable metadata row.
  - The text "Audit records can't be edited or deleted" (FR-AUD-03) and no edit controls at all.
  - "Export CSV" shows the toast "Export logged".
- Smoke: expects `Audit` and `failed sign-in`. `od-role=employee` gets `Access restricted`.

---

## Phase 4: Outside the tenant app

### Task 21: Auth pages (`features/auth`, route group `app/(auth)`)
**Files:**
- `app/(auth)/layout.tsx`: a centred card on `--panel`, with the logo from the tenant and no AppShell
- `app/(auth)/{sign-in,forgot-password}/{page,loading}.tsx`
- `features/auth/...`
- `app/styles/auth.css`
- Modify `app/(app)/layout.tsx`: `if (!session.signedIn) redirect("/sign-in")`

**Behaviour:**
- **Sign-in:** email and password fields with zod. A wrong format shows a fix-it message.
  - Submit goes to the MFA step: a 6-digit code input (FR-AUTH-04). Any 6 digits pass.
  - Then a "Continue as" role select, defaulting to owner, and the `signIn(roleId)` server action.
  - Links to "Forgot password" and "Create a company account" (`/sign-up`).
  - These are test values only. Never pre-fill a real-looking password.
- **Forgot password:** email, then the "Check your email" state (FR-AUTH-05).
- **Smoke:**
  - `/sign-in` expects `Sign in`.
  - `/` with `od-auth=out` returns `status: 307` or `303`. Check the exact code `redirect()` returns in this Next version and pin it.

### Task 22: Sign-up and onboarding (FR-SAAS-03/04)
**Files:**
- `app/(auth)/sign-up/{page,loading}.tsx`, `app/(auth)/onboarding/{page,loading}.tsx`
- `public/data/auth/{plans,onboarding-defaults}.json`, which reuse the plan names and limits from `public/data/billing/plans.json`. Read through `features/auth/api.ts` from the same file path. Reading the same JSON is allowed; importing the billing feature is not.

**Behaviour:**
- **Sign-up stepper:**
  1. Organisation: company name, subdomain preview, country, timezone
  2. Owner account: name, work email, password with strength hints
  3. Verify email: "We sent a link to …", with a "I've verified" button
  4. Plan: a grid that defaults to "Start 14-day trial"
  - Finish goes to `/onboarding`.
- **Onboarding checklist stepper:**
  1. Departments, pre-seeded Security and Cleaning, editable
  2. Timezone and deadline, defaulting to 17:30
  3. Report template, the 10 sections, toggle per department
  4. Invite users: rows of email, role and department
  - Finish calls `signIn("owner")`, which lands on `/`.
- Steps can be revisited. The progress is shown with `.progress`.
- **Smoke:**
  - `/sign-up` expects `Organisation`.
  - `/onboarding` expects `Departments`.

### Task 23: Platform Super Admin console (FR-SAAS-09/10)
**Files:**
- `app/(platform)/layout.tsx`: reuses `AppShell` with `public/data/platform/navigation.json` and no department seg. Add an `AppShell` prop `departments?: false` to hide the seg.
- `app/(platform)/platform/{page,loading}.tsx`, `app/(platform)/platform/tenants/[id]/{page,loading}.tsx`, `app/(platform)/platform/plans/...`, `app/(platform)/platform/support/...`
- `features/platform/...`
- `public/data/platform/{navigation,tenants,plans,support-requests,audit}.json`
- `app/styles/platform.css`

**Behaviour:**
- **Gate:** only `role.platform` gets in. Others see `AccessRestricted`.
- **Overview:** stats (tenants, MRR, trials, past due), plus a tenants table showing name, subdomain, plan, status, users, storage, created and MRR, with filters.
- **Tenant detail:** subscription, usage against limits, contacts and billing status.
  - Suspend or Reactivate goes through `ConfirmDialog` (typing the tenant slug).
  - An explicit panel says "Operational data hidden: requires tenant-granted support access" (FR-SAAS-09).
- **Plans:** plan cards with limits and modules, editable in a dialog.
- **Support access:** requests showing tenant, requester, reason, status (`requested|granted|expired|revoked`) and expiry. A granted request shows a "View as support" button with a countdown, and everything is audited (FR-SAAS-10).
- **Smoke:**
  - `/platform` with `od-role=platform` expects `Tenants`.
  - `/platform` with no cookie expects `Access restricted`.

---

## Task 24: Consistency, docs, final review
- **Sidebar:**
  - `navigation.json` badges stay "14" and "4".
  - Remove `description`/`srs` only if no route still needs Coming soon.
  - Delete `app/(app)/[section]` **only if** every nav href now has a static route.
  - Run `npm run smoke` over every route.
- **Docs:**
  - Update `.claude/docs/architecture.md` with the new features, `app/styles/`, `lib/session.ts`, `lib/store.ts` and the smoke and tests.
  - Add a short brief per feature under `.claude/docs/<feature>/README.md`: what it does, its SRS refs, its JSON files and its gates.
  - Update `.claude/docs/README.md` (the index) and the CLAUDE.md "Architecture" lines, adding the session, roles and kit.
- **Final checks:**
  - `npm test`, `npm run smoke`, `npm run typecheck` and `npm run lint`. The only allowed failure is the pre-existing `nav-user.tsx` one, if it still exists after Task 3's edits. In that case fix it properly with a mount check that doesn't use setState in an effect, such as `useSyncExternalStore`.
  - Whole-branch review on Opus. Then the controller does the browser pass: every route in light, dark and 360px, plus skeleton height checks per `architecture.md` → Skeletons.
