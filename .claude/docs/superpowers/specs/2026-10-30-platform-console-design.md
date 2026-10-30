# Platform console (SaaS admin): design

Date: 30 Oct 2026. Owner decision: "make the SaaS admin perfect, professional and industry standard; decide yourself."
Backend comes later, so this is front-end only (mock JSON seed + client stores), shaped so the backend can implement the
same types as its API contract. Requirements: SRS FR-M0-01, 02, 13, 14, 15, 19; old spec FR-SAAS-06..15 (`SRS-v1.2-built.md`).

## Why

The console today is three pages inside the tenant app's shell:
- Tenants list with 4 KPIs, a tenant detail page, Plans, and Support access.
- It reads as a prototype, not as the tool a SaaS company runs its business from.

Benchmarks: Stripe Dashboard, Vercel/Clerk/WorkOS admin, Chargebee. These consoles all share:
- a clear operator identity;
- a revenue overview;
- customer health;
- a billing ledger;
- an immutable audit trail;
- staff roles;
- privacy-safe support;
- fast search;
- table tooling (sort, filter, saved views, export).

## Goals

1. **Identity:** the operator always knows they are in the platform console (not a tenant) and in which environment.
2. **Overview:** in 10 seconds the operator sees revenue, growth, risk and what needs action today.
3. **Tenant 360:** every tenant has one place for subscription, billing, usage, modules, support, audit and lifecycle actions.
4. **Revenue:** invoices and failed payments are first-class (dunning queue), through the provider-agnostic billing module.
5. **Trust:**
   - Staff roles with least privilege.
   - Every sensitive action needs a reason and lands in an immutable audit log with old → new values.
   - Tenant data stays hidden without consent.
6. **Compliance:** GDPR export/deletion requests (FR-M0-19, FR-SAAS-15) have their own queue with deadlines.
7. **Craft:**
   - Sortable, filterable, paginated tables with saved views and CSV export.
   - Command palette search; copyable IDs; formatted numbers and money.
   - Exact skeletons; light/dark; 390px.

## Non-goals

- Real Stripe or email.
- A feature-flag system beyond per-tenant module overrides.
- Impersonation without consent (never).
- BI or report builder (Module 9).
- Multi-region.
- Editing tenant operational data.

## Anti-goals (a failure even if it works)

- Showing tenant tasks, reports, staff or files in the console without a granted support session.
- A destructive action without a reason, confirmation and audit line.
- Generic shadcn look. OpsDesk tokens only (ui-rules.md).

## Decisions (made by Claude, flagged as such)

**D1. Console shell**
- `AppShell` gets `variant="platform"`:
  - no Android promo card, no department filter;
  - a "Platform" badge and an environment pill in the topbar (from settings: "Live" / "Test mode");
  - the operator's identity from `public/data/platform/staff.json`, not the tenant user.
- The bell shows platform alerts. The search uses a platform index: tenants, invoices, support requests, data requests, staff, pages.

**D2. Navigation in groups**
- Sidebar section headings come from an optional `section` on nav items.

| Section | Pages |
|---|---|
| (top) | Overview `/platform` |
| Customers | Tenants `/platform/tenants` |
| Revenue | Billing `/platform/billing`, Plans `/platform/plans` |
| Trust | Support access `/platform/support`, Data requests `/platform/data-requests`, Audit log `/platform/audit` |
| Admin | Team `/platform/team`, Settings `/platform/settings` |

- The current tenants list moves from `/platform` to `/platform/tenants`. `/platform` becomes the overview.

**D3. Staff roles**
- Four platform staff roles:
  - `owner`: everything.
  - `support`: tenants read, support access, data requests.
  - `billing`: tenants read, billing, plans.
  - `viewer`: read only.
- One permission map: `features/platform/permissions.ts` → `staffCan(role, action)`.
- Pages gate on the server; buttons hide when not allowed.
- Mock: the operator's staff role comes from staff.json. A dev-only `od-staff-role` cookie overrides it for testing.

**D4. Metrics are computed, not stored**
- From `subscriptions.json` (an event log: start, upgrade, downgrade, cancel, reactivate, each with an MRR delta) and `invoices.json`.
- Pure functions in `features/platform/metrics.ts`: MRR series by month (new / expansion / contraction / churn), ARR, net revenue retention, logo churn, ARPA, trial conversion.
- Months follow the platform clock (`org.today`, Europe/Dublin).

**D5. Health score**
- `features/platform/health.ts` returns 0–100 plus the reasons behind it.
- Inputs: payment state (past due, failed invoices), seat use, usage trend over 30 days vs the previous 30, pending support requests.
- Bands: Healthy ≥ 70, Watch 40–69, At risk < 40.
- Shown as a pill with a tooltip listing the reasons.

**D6. Shared table tooling**
- `components/sort-header.tsx`: an accessible sortable column header (aria-sort).
- `lib/csv.ts`: CSV building and download (reuse an existing helper if one exists).
- Saved views = `FilterSeg` presets (ui-rules rule 30).

**D7. Sensitive actions**
- Suspend, reactivate, plan change, trial extension, credit, refund, deletion scheduling, module override, staff role change.
- Each needs a reason (required text). Destructive ones also need type-to-confirm (the tenant slug).
- Each writes an audit entry `{actor, staffRole, action, target, before, after, reason, at}`.

**D8. Privacy**
- The tenant 360 shows counts, contacts and admins only, never member lists or operational records (FR-SAAS-09).
- The existing "Operational data hidden" card stays.

**D9. Long forms are pages, tabs are segs**
- Long forms become pages (rule 31); tab bars are `FilterSeg` / route segs (rule 30).
- Tenant 360 tabs are routes: `/platform/tenants/[id]/[tab]`, with tabs overview, billing, usage, modules, support, audit, settings.
- Every route has an exact skeleton (`SkMask` where possible) and a `loading.tsx`.

**D10. Platform settings and announcements**
- Settings (mock): payment provider status and mode, default trial length, data retention days, default support-access duration, and an announcement banner.
- The announcement (info or maintenance, with an optional end time) shows in every tenant's app shell through `lib/platform-notice.ts`. That is a pure lib plus data, so features stay isolated.

**D11. Numbers**
- One formatter set: money with thousands separators and the plan currency; compact numbers on KPI cards (€12.4k); exact values in tables.
- Totals across tenants are in the platform currency (EUR).
- Deltas show ▲/▼ vs the previous period, coloured by meaning, not by sign.

## What is left to the builder

Exact copy, spacing within OpsDesk tokens, chart styling (follow the existing dashboard chart and the dataviz skill),
seed data volumes (enough to make every view meaningful: 14 tenants, 12 months of events and invoices, 90 days of usage).
