# Platform Console (SaaS admin) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the platform console into an industry-standard SaaS admin. It gets:
- its own identity and grouped navigation;
- a revenue overview;
- a tenant 360 with tabs;
- a billing ledger with a dunning queue;
- GDPR data requests;
- an immutable audit log;
- staff roles;
- platform settings;
- professional table tooling.

**Architecture:**
- Front-end mock. JSON seed in `public/data/platform/`, client stores in `features/platform/store.ts`, pure logic (metrics, health, permissions) in `features/platform/*.ts` with unit tests.
- Routes live under `app/(platform)/platform/`.
- Shared pieces go in `components/` and `lib/` only when the tenant app also uses them. Features never import each other.

**Tech Stack:** Next.js 16 App Router, React 19, shadcn base-nova on base-ui (OpsDesk skin), recharts via `components/ui/chart.tsx`, `motion/react` (rules only), vitest.

**Spec:** `.claude/docs/superpowers/specs/2026-10-30-platform-console-design.md` (decisions D1–D11 are referenced below).

## Global Constraints

- Read first: `CLAUDE.md`, `.claude/docs/architecture.md`, `.claude/docs/00-design-system/ui-rules.md`, `.superpowers/sdd/phase1/common.md`.
- **Dev server:**
  - Use port 3001; never touch port 3000 (another project).
  - Smoke: `SMOKE_BASE=http://localhost:3001 node scripts/smoke.mjs`.
  - Never run `next build`.
- **Look:** OpsDesk tokens, borderless, big radius, never shadcn defaults. Light is the default and dark must work. Hover on card rows changes text colour only.
- **Tabs and forms:** tabs and view switches are `FilterSeg` (rule 30). A form needing scroll at 1568×698 is a page with `.od-form-cols` (rule 31).
- **Skeletons:** every route gets a `loading.tsx` with an exact skeleton (`SkMask` around the real component where data allows).
- **Data:**
  - No hard-coded tenant values.
  - Money is `Intl.NumberFormat("en-IE")` with the plan's currency; cross-tenant totals are in EUR (D11).
  - The platform clock is `org.today`.
- **Privacy (D8):** never render tenant operational data (tasks, reports, members, files) in the console.
- **Sensitive actions (D7):** every one has a required reason. Destructive ones have type-to-confirm. Each writes an audit entry with before and after.
- **Never remove or break** WhatsApp, Orders & Stock, client files, or the rosters incident/cover model.
- **Browser:**
  - Never change the browser `od-role` cookie permanently.
  - To view the console, set `od-role=platform`, then restore the previous value before finishing (read it first).
  - Use your own tab and close it at the end.
- **Git:** no commits unless the controller says so.

## Review Focus

1. **A tenant with no invoices** (a new trial): MRR is 0, the health score still computes, and the billing tab shows an empty state rather than crashing. Test in Task 2.
2. **A staff role without permission opens a URL directly** (e.g. `support` opens `/platform/billing`): the server shows "Access restricted" and no data is in the payload. Smoke in Tasks 1 and 6.
3. **Month boundaries:** an event on the last day of a month at 23:30 Dublin time counts in that month (the platform clock, not UTC). Test in Task 2.
4. **Long names and amounts at 390px:**
   - tenant names over 40 characters;
   - an MRR of €1,234,567;
   - pills that don't overflow.
   Check in Tasks 4 and 5.
5. **Suspend → reactivate round trip:** restores the previous status (trial or active), keeps both audit lines, and leaves the subscription unchanged. Test in Task 5.

---

### Task 1: Console shell, grouped navigation, staff roles

Implements D1, D2, D3.

**Files:**
- Modify:
  - `features/shell/components/app-shell.tsx`: `variant?: "app" | "platform"` hides the promo card and dept filter, and shows the badge and env pill.
  - The nav item type: optional `section?: string`. The sidebar renders section headings.
  - `app/(platform)/layout.tsx`: platform user, platform alerts, platform search.
  - `public/data/platform/navigation.json`: groups per D2.
- Create:
  - `public/data/platform/staff.json`: 6 staff covering the 4 roles, each with email, MFA on/off, last sign-in.
  - `features/platform/permissions.ts` and its test.
  - `features/platform/search-index.ts`: platform search entries.
  - Placeholder pages for the new routes (Tasks 3–9 fill them): `app/(platform)/platform/{tenants,billing,data-requests,audit,team,settings}/page.tsx` + `loading.tsx`. A placeholder = PageHead + EmptyState "Coming in this release" with a skeleton.
- Move: the tenants list page from `/platform` to `/platform/tenants`. `/platform` becomes the overview placeholder.

**Interfaces (Produces):**
```ts
export type StaffRole = "owner" | "support" | "billing" | "viewer"
export type StaffMember = { id: string; name: string; email: string; role: StaffRole; mfa: boolean; lastSignInAt: string | null; status: "active" | "invited" | "disabled" }
export type PlatformAction =
  | "tenants.read" | "tenants.suspend" | "tenants.lifecycle" | "tenants.modules"
  | "billing.read" | "billing.write" | "plans.write"
  | "support.request" | "data.requests" | "audit.read" | "team.manage" | "settings.write"
export function staffCan(role: StaffRole, action: PlatformAction): boolean
export async function getOperator(): Promise<StaffMember>   // features/platform/api.ts; reads od-staff-role cookie override (dev)
export function requireStaff(op: StaffMember, action: PlatformAction): boolean  // page-level gate helper
```

- [ ] **Step 1: Test.** `permissions.test.ts`:
  - `staffCan("owner", a)` is true for every action.
  - `staffCan("viewer", a)` is true only for `*.read`.
  - `support` can do `support.request` and `data.requests` but not `billing.write` or `plans.write`.
  - `billing` can do `billing.write` and `plans.write` but not `support.request`.
- [ ] **Step 2:** run `npx vitest run features/platform/permissions.test.ts`. Expect FAIL (module missing).
- [ ] **Step 3:** implement the role → action map, `getOperator`, the shell variant, the nav sections and the placeholders. Gate every console page with `requireStaff`, falling back to the existing "Access restricted" pattern.
- [ ] **Step 4:** the test passes. In the browser (as platform):
  - no promo card;
  - "Platform" badge visible;
  - nav shows 4 section headings;
  - search shows the tenant names.
  Then repeat in dark and at 390.
- [ ] **Step 5:** smoke file `scripts/smoke/platform-console.json`:
  - every new route renders for `od-role=platform`;
  - `od-role=manager` gets "Access restricted";
  - `od-staff-role=support` on `/platform/billing` gets "Access restricted".

### Task 2: Data model and metrics

Implements D4 and D5.

**Files:**
- Create seed in `public/data/platform/`:
  - `subscriptions.json`: event log, 12 months, consistent with the tenants' current plans and status.
  - `invoices.json`: monthly invoices per paying tenant, with statuses paid / open / failed / refunded / void, and the 2 past-due tenants having failed invoices.
  - `usage.json`: 90 daily points per tenant for active users, storage, messages and transcription.
  - `data-requests.json`: 6 requests with mixed type and status.
  - `settings.json`: D10 fields.
  - Extend `audit.json` entries with `staffRole`, `before`, `after`, `reason`, without breaking old entries.
- Create:
  - `features/platform/metrics.ts` + test.
  - `features/platform/health.ts` + test.
  - Types in `features/platform/types.ts`.
  - Loaders in `api.ts` (`getPlatformSeed` returns the new arrays).
  - Stores in `store.ts`.

**Interfaces (Produces):**
```ts
export type SubEvent = { id: string; tenantId: string; at: string; kind: "start" | "upgrade" | "downgrade" | "cancel" | "reactivate"; plan: string; mrrDelta: number }
export type InvoiceStatus = "paid" | "open" | "failed" | "refunded" | "void"
export type Invoice = { id: string; tenantId: string; number: string; issuedAt: string; dueAt: string; amount: number; currency: string; status: InvoiceStatus; attempts: number; nextRetryAt: string | null; lines: { label: string; amount: number }[] }
export type UsagePoint = { date: string; activeUsers: number; storageGb: number; messages: number; transcriptionMinutes: number }
export type DataRequest = { id: string; tenantId: string; kind: "export" | "deletion" | "correction"; subject: "tenant" | "person"; requestedBy: string; requestedAt: string; dueAt: string; status: "received" | "in_progress" | "completed" | "rejected"; note: string }
export type MrrMonth = { month: string /* YYYY-MM */; mrr: number; new: number; expansion: number; contraction: number; churn: number }
export function monthKey(iso: string): string                        // platform wall clock, no UTC shift
export function mrrSeries(events: SubEvent[], endMonth: string, months: number): MrrMonth[]
export function kpis(series: MrrMonth[], tenants: PlatformTenant[], events: SubEvent[]): { mrr: number; arr: number; mrrDeltaPct: number | null; nrrPct: number | null; logoChurnPct: number | null; arpa: number; trials: number; trialConversionPct: number | null; pastDue: number }
export type Health = { score: number; band: "healthy" | "watch" | "at_risk"; reasons: string[] }
export function healthScore(t: PlatformTenant, plan: Plan | undefined, usage: UsagePoint[], invoices: Invoice[], openSupport: number): Health
```

- [ ] **Step 1: Tests.** `metrics.test.ts`:
  - `monthKey("2026-09-30T23:30:00") === "2026-09"`.
  - A start of 149 in 2026-01 plus an upgrade of +250 in 2026-03 gives MRR 149, 149, 399 and `new` 149 in Jan, `expansion` 250 in Mar.
  - A cancel gives `churn` equal to the negative MRR in that month.
  - `kpis().arr === mrr * 12`.
  - `nrrPct` and `logoChurnPct` are `null` when there is no prior-period base.
  - `arpa === 0` with no paying tenants.
- [ ] **Step 2: Tests.** `health.test.ts`:
  - An active tenant, paid invoices, steady usage and no support requests scores ≥ 70 ("healthy").
  - A past-due tenant with 2 failed invoices is "at_risk" and the reasons include "2 failed payments".
  - A trial tenant with no invoices still computes, with no throw.
  - Seat use > 95% adds the reason "Near user limit".
- [ ] **Step 3:** run the tests, expect FAIL. Implement. Run, expect PASS.
- [ ] **Step 4: Seed check.** A test loads the seed JSON and asserts that `mrrSeries(...)` for the current month equals the sum of `tenantMrr` over active and past-due tenants (the seed is self-consistent).

### Task 3: Overview dashboard `/platform`

**Interfaces (Consumes):** `mrrSeries`, `kpis`, `healthScore` (Task 2), `staffCan` (Task 1).

**Files:**
- Create `features/platform/components/overview-dashboard.tsx` and its skeleton.
- Modify `app/(platform)/platform/page.tsx` and `loading.tsx`.

**Layout:**
1. A KPI row: MRR, ARR, active tenants, trials (with conversion %), past due, NRR. Each shows a delta vs the previous month, a compact number and count-up.
2. Charts:
   - **MRR trend:** a 12-month area chart with a stacked bar of the new / expansion / contraction / churn breakdown, with a legend. Follow the dashboard chart in `features/dashboard` and the dataviz skill.
   - **Plan mix:** a donut or bars, counts and MRR per plan.
3. "Needs attention" list, each row linking to the right place:
   - past-due tenants (→ the billing tab);
   - trials ending within 7 days;
   - tenants over 90% of any limit;
   - pending support requests;
   - data requests due within 7 days.
4. Recent activity: the last 8 audit entries, plus a "View audit log" link.

- [ ] **Step 1:** unit-test the selector `attentionItems(seed, today)` in `features/platform/attention.ts`:
  - counts of each kind from the seed;
  - ordering (overdue money first, then deadlines soonest).
- [ ] **Step 2:** implement the component and the skeleton. Browser check at 1568, 768, 390, light and dark. The skeleton must match the real page (measure the card heights).
- [ ] **Step 3:** smoke: `/platform` expects "Monthly recurring revenue" and "Needs attention".

### Task 4: Tenants list `/platform/tenants`

**Files:**
- Create `components/sort-header.tsx` (shared), `lib/csv.ts` + test (or reuse an existing CSV helper; grep first).
- Modify `features/platform/components/tenant-table.tsx`, `logic.ts` (`filterTenants`, `sortTenants`).

**Interfaces:**
```ts
export type TenantSort = { key: "name" | "plan" | "status" | "users" | "storage" | "mrr" | "health" | "created"; dir: "asc" | "desc" }
export function sortTenants(rows: TenantRow[], s: TenantSort): TenantRow[]
export type TenantRow = PlatformTenant & { mrr: number; health: Health; seatPct: number }
export function toCsv(rows: Record<string, string | number>[], columns: { key: string; label: string }[]): string
```

- **Saved views** (`FilterSeg`): All, Trials, Past due, At risk, Suspended, each with a count.
- **Filters:** search (name, slug, id), plan, status.
- **Columns:**
  - Tenant: name + slug, with a copy-ID button.
  - Plan.
  - Status pill.
  - Health pill (tooltip lists the reasons).
  - Users, as used/limit with a thin bar.
  - Storage.
  - MRR.
  - Created.
  - A row actions menu: Open, Copy ID, Request support access, Suspend/Reactivate (only when `staffCan`).
- Sorting comes from the column headers. Pagination as now. Export CSV of the filtered rows.

- [ ] **Step 1:** tests:
  - `sortTenants`: sort by MRR desc puts the enterprise tenant first, and ties keep name order.
  - `toCsv`: escapes commas and quotes.
- [ ] **Step 2:** implement, then browser checks (Review Focus 4), then smoke for `/platform/tenants?view=past_due`, which shows only past-due rows (a view in a search param so it is linkable).

### Task 5: Tenant 360 `/platform/tenants/[id]/[tab]`

**Files:**
- Create `app/(platform)/platform/tenants/[id]/[tab]/page.tsx` + `loading.tsx`. `[id]/page.tsx` redirects to `overview`.
- Create `features/platform/components/tenant-360/{header,overview,billing,usage,modules,support,audit,settings}.tsx`, plus pages for long forms:
  - `.../[id]/change-plan`;
  - `.../[id]/extend-trial`;
  - `.../[id]/schedule-deletion`.

**Header:**
- Name, slug, copy ID, status pill, health pill, plan.
- Primary action by state:
  - past due → "Retry payment";
  - trial → "Extend trial";
  - suspended → "Reactivate".
- An overflow menu for the rest.
- The tab seg below it.

**Tabs:**
- **overview:** subscription summary, health with reasons, 4 usage cards with 30-day sparklines vs limit, contacts, the "Operational data hidden" card (D8), internal notes (staff-only text, audited).
- **billing:** subscription (plan, price, renews, payment method), invoices table (status, amount, attempts, next retry) with an invoice detail sheet, credits balance. Actions: change plan, apply credit, cancel at period end.
- **usage:** 90-day charts per metric with the limit line.
- **modules:** plan modules plus per-tenant overrides (grant or revoke an add-on with a reason). The effective entitlements feed `lib/entitlements.ts` the same way plan modules do.
- **support:** this tenant's support sessions, plus the request button.
- **audit:** the audit log filtered to this tenant.
- **settings (danger zone):**
  - suspend or reactivate;
  - change slug (existing type-to-confirm);
  - export tenant data (creates a data request);
  - schedule deletion after the retention period (type-to-confirm).

Every action follows D7 and is gated by `staffCan`.

- [ ] **Step 1:** tests in `logic.test.ts`:
  - `changePlan(tenant, plan, at, reason)` returns the tenant plus a SubEvent with the correct `mrrDelta` sign (upgrade positive, downgrade negative).
  - `extendTrial` adds days and refuses when not a trial.
  - Review Focus 5: suspend → reactivate restores the previous status, both audit entries exist, and there is no SubEvent.
  - `scheduleDeletion` sets `deletionAt = today + settings.retentionDays`.
- [ ] **Step 2:** implement the tabs one by one, each with an exact skeleton. Browser check at 1568 and 390, light and dark, with Review Focus 4 on the header.
- [ ] **Step 3:** smoke for each tab route and an unknown id (404 text). `support` staff can see the tenant but not "Change plan".

### Task 6: Billing `/platform/billing`

**Files:** `features/platform/components/billing-ledger.tsx`, skeleton, route.

- **Summary row:** collected this month, open, failed, refunded (EUR).
- **Saved views:** All, Open, Failed (dunning), Refunded.
- **Ledger table:** number, tenant, issued, due, amount, status, attempts, next retry. Sortable, CSV export.
- **Invoice detail sheet:** lines, history.
- **Actions** (billing.write):
  - retry payment (mock outcome: succeeds if the tenant has a payment method);
  - mark paid (reason);
  - refund (reason + confirm);
  - void (reason).
- **Dunning:** a failed invoice shows its retry schedule. The 3rd failure suggests suspension (a link to the tenant's settings tab, never automatic).

- [ ] **Step 1:** tests:
  - `retryPayment` increments `attempts` and either sets `paid` or schedules `nextRetryAt` (+3 days).
  - `refund` only from `paid`; `void` only from `open` or `failed`.
- [ ] **Step 2:** implement plus browser checks. Smoke: `/platform/billing` for `billing` staff shows the ledger; `support` staff get "Access restricted".

### Task 7: Plans upgrade `/platform/plans`

- A comparison view: plans as columns, limits and modules as rows, tenants per plan, MRR per plan.
- "New plan" is a page (`/platform/plans/new`), reusing `plan-form.tsx`.
- "Archive plan" is allowed only with 0 tenants (otherwise explain why).
- A price change shows a notice: "Existing tenants keep their price until renewal", and the audit records before and after.

- [ ] **Step 1:** tests:
  - `canArchive(plan, tenants)` is false when a tenant is on the plan.
  - `newPlan` validation: unique id, price ≥ 0.
- [ ] **Step 2:** implement, the skeleton, smoke for `/platform/plans/new`.

### Task 8: Data requests `/platform/data-requests`

- **Queue:**
  - saved views: Open, Due soon, Completed;
  - columns: type, subject, tenant, requested, due (30-day SLA countdown, red when < 7 days), status.
- **Actions** (data.requests): start, complete (attach "export ready" note), reject (reason). Deletion completion is only allowed once the tenant's `deletionAt` has passed.
- Every change is audited.

- [ ] **Step 1:** tests:
  - `dueIn(req, today)`;
  - status transitions (received → in_progress → completed | rejected; nothing else).
- [ ] **Step 2:** implement, the skeleton, smoke.

### Task 9: Audit log, team, settings

**Audit log `/platform/audit`:**
- Read-only, immutable; there are no edit or delete controls anywhere.
- Filters: actor, action, tenant, date range.
- Each row expands to show before → after and the reason. CSV export.

**Team `/platform/team`** (team.manage):
- Staff table: role, MFA, last sign-in, status.
- Invite staff (short dialog).
- Change role (reason, audited).
- Disable.
- MFA is required for staff: rows without MFA show "MFA required" and those staff can't be given owner.

**Settings `/platform/settings`** (settings.write), a form page with `.od-form-cols`:
- payment provider status and mode (read-only "Stripe · Test mode" from the billing provider);
- default trial days;
- retention days;
- default support-access hours;
- announcement (kind, message, optional end).
- The announcement shows as a banner in every tenant app shell via `lib/platform-notice.ts` (`activeNotice(settings, now)`), read in `app/(app)/layout.tsx`.

- [ ] **Step 1:** tests:
  - `activeNotice` is null after `endsAt`;
  - a role change to owner is refused when `mfa=false`;
  - audit filters combine (AND).
- [ ] **Step 2:** implement three routes with skeletons. Browser check: set an announcement, then open a tenant page and confirm the banner shows (light and dark, 390).
- [ ] **Step 3:** smoke for all three. `viewer` staff see Settings read-only (no Save).

### Task 10: Polish and standards pass

**Command palette (⌘K) in the console:**
- jump to pages;
- search tenants by name, slug or id;
- find invoices by number;
- run actions: "Request support access for …".

**Platform-wide consistency:**
- copy-ID buttons on every ID;
- relative times with the absolute time in a tooltip and the timezone label;
- consistent empty states;
- focus rings;
- keyboard navigation on tables;
- `aria-sort`.

**Docs:**
- a new `.claude/docs/features/platform.md` (routes, staff roles, metrics definitions, privacy rule), listed in the docs README;
- the architecture rule-3 list (new shared `components/sort-header.tsx`, `lib/csv.ts`, `lib/platform-notice.ts`);
- an SRS Appendix A status row.

**Final verification:**
- tsc, eslint, vitest, smoke 0 FAIL.
- The overlap scanner and the dialog-scroll scan, re-run over every console route at 1568, 768 and 390.
