# Platform console (SaaS admin)

The operator's console for running the SaaS: revenue, tenants, trust and the platform team. Since B6 T6.8 the backed pages run on the platform
staff API (`/v1/platform/*`); the pages with no API route keep their mock seed (`public/data/platform/`) and are shown only with `ENABLE_MOCK_MODULES=1`.
Design and decisions D1–D11: `superpowers/specs/2026-10-30-platform-console-design.md`.
Requirements: SRS FR-M0-01, 02, 13, 14, 15, 19; old spec FR-SAAS-06..15 (`requirements/SRS-v1.2-built.md`).

Code: live side `features/platform/{api,adapters,client}.ts` (server loaders, pure DTO mappers, the one write client) and `components/live-*.tsx`;
mock side `features/platform/mock.ts` plus the old seed-driven components (billing ledger, plans, usage, notes); routes in `app/(platform)/**`; the ⌘K
index action in `app/actions/platform-search.ts`. Only active platform staff (`/v1/me.platformRole`) get in; everyone else sees "Access restricted"
without the console's nav or search.

### Live pages: how they work

- **Operator** = the signed-in user: `getOperator()` builds the staff member from `getPlatformSession()` (role from `/v1/me.platformRole`). No seed, no `od-staff-role`.
- **Second factor** (T6.3 carry-in): every `/v1/platform/*` route needs an enrolled factor and a session that passed it (401 `mfa_enrolment_required` / `mfa_challenge`).
  `getPlatformSession()` computes `session.mfa` with `resolvePlatformMfa` (`lib/session-core.ts`: no factor on `/v1/me` is "enrol" without a call, otherwise one one-row
  `GET /v1/platform/tenants` probe). `gate()` returns the same `MfaGate` / `MfaStepUp` a company page gets, and the layout swaps its children for it; the search action returns nothing.
- **Reads**: pages call `gate()`, then `apiServer()` through `settle()` (JSX is never built inside try/catch); a 403 is the "Access restricted" state, anything else the error page.
- **Writes**: `usePlatform()` (`components/use-platform.ts`) wraps `makePlatformClient(apiBrowser)` in `use-api-action`: one request per key, mapped copy plus "Ref", refresh after every answer.
  The client refuses a bad reason (1 to 500), trial days (1 to 30), grant hours (1 to 24) before any request.
- **Tenants**: the list is the API's page (`?page=`, `?q=`, 100 per page, newest first); saved views other than suspended and every sort work on the loaded page and the list says so.
  Metadata only; the 360 is aggregates (counts, one date), never a member name or email.
- **Modules**: the module catalogue and plan table come from the static `billing/entitlements.json`, which can drift from the API's plans table (the API stays the authority and refuses unknown modules). The tab drafts changes, then one `PUT .../modules` sends the FULL overrides array with the reason (the API replaces the list). Core modules can't be revoked.
- **Support access**: `POST .../support-grants` (reason, hours) for the caller and `DELETE /v1/platform/support-grants/{id}`. There is no staff list route, so the page shows the grants made in this visit;
  the tenant owner sees every grant under `/settings/support-access`.
- **Settings** (owner only): email (Resend), storage (R2) and billing (Stripe). The forms start empty; an empty secret keeps the stored one; only the last 4 come back. The Test / Live pill comes from the
  Stripe publishable key prefix (`pk_test_` / `pk_live_`), owner only.
- **Times** show in UTC (the console is not inside a company). Money is the API's integer minor units per currency.
- **Skeletons**: every `loading.tsx` is static (K1): it renders the real view masked (`SkMask`) with typical sample rows, no data layer. Mock pages use `MockPageSkeleton`.
- **Not carried over**: the platform bell (alerts) is empty, the old health score, MRR per tenant and plan-mix columns need data the API does not have, support requests and data-request resolving have no routes.

## API coverage (B6 T6.8)

Page-by-route table from the generated `paths` (`lib/api/schema.d.ts`). **Backed** pages run on the platform staff API; **unbacked** pages keep their
mock seed (`public/data/platform/*`) and are shown only with `ENABLE_MOCK_MODULES=1` (ruling I16); without it they show the unavailable state and their nav entry is hidden.
The operator is the signed-in user (`/v1/me.platformRole`), not `platform/staff.json`; the `od-staff-role` override is gone.

| Console page | Status | Routes it uses |
| --- | --- | --- |
| Overview KPIs and MRR | backed | `GET /v1/platform/metrics` (MRR counts `active` only; `past_due` is its own count, C11), `GET /v1/platform/tenants` |
| Overview plan mix, recent activity, MRR history chart | unbacked, mock | needs the subscription event log; no route |
| Tenants list and saved views | backed | `GET /v1/platform/tenants?q&status&plan&page&pageSize` (metadata only) |
| Tenant 360: overview, modules, support, audit tabs | backed | `GET /v1/platform/tenants/{tenantId}` (aggregates only), `PUT .../modules`, `POST .../support-grants`, `GET /v1/platform/audit?targetTenantId` |
| Suspend, reactivate | backed | `POST .../suspend`, `POST .../reactivate` (reason 1-500; 409 `already_suspended`, `not_suspended`) |
| Extend trial | backed | `POST .../extend-trial` (days 1-30, reason) |
| Module overrides | backed | `PUT .../modules` with the full overrides array |
| Support access | backed | `POST /v1/platform/tenants/{tenantId}/support-grants`, `DELETE /v1/platform/support-grants/{id}` (no list route: grants show on the tenant's `/settings/support-access`) |
| Data requests | backed (read) | `GET /v1/platform/data-requests` (no subject identity; no resolve route) |
| Audit log and export | backed | `GET /v1/platform/audit`, `GET /v1/platform/audit/export` (CSV, through the BFF) |
| Team (staff) | backed | `GET/POST /v1/platform/staff`, `PATCH /v1/platform/staff/{userId}` |
| Settings: email, storage, billing | backed | `GET/PUT /v1/platform/settings/{email,storage,billing}` (+ `/test` for email and storage); secrets are never returned, only the last 4 |
| Plans (list, new, edit, archive) | **unbacked, mock** | no route |
| Invoice ledger and dunning | **unbacked, mock** | no route |
| Usage series (360 Usage tab, overview usage sparks) | **unbacked, mock** | no route |
| Tenant notes, change plan, schedule deletion, credit | **unbacked, mock** | no route |
| Subscription event log behind the MRR history chart | **unbacked, mock** | `/v1/platform/metrics` has no series |

## Routes

| Route | Page | Gate (staff action) |
| --- | --- | --- |
| `/platform` | Overview: KPIs, MRR chart, plan mix, needs attention, recent activity | `tenants.read` (revenue cards need `billing.read`) |
| `/platform/tenants` | Tenants list: sort, filter, saved views `?view=all\|trial\|past_due\|at_risk\|suspended`, CSV | `tenants.read` (MRR column needs `billing.read`) |
| `/platform/tenants/[id]` | Redirects to the overview tab | `tenants.read` |
| `/platform/tenants/[id]/[tab]` | Tenant 360 tabs: overview, billing, usage, modules, support, audit, settings | per tab: billing → `billing.read`, audit → `audit.read`, others `tenants.read` |
| `/platform/tenants/[id]/change-plan`, `/extend-trial` | Lifecycle form pages (rule 31) | `billing.write` |
| `/platform/tenants/[id]/schedule-deletion` | Lifecycle form page | `tenants.lifecycle` |
| `/platform/billing` | Invoice ledger + dunning queue, `?view=all\|open\|failed\|refunded`, `?q=` search | `billing.read` (actions `billing.write`) |
| `/platform/plans` | Plan comparison, archive | `billing.read` (Edit/Archive/New `plans.write`) |
| `/platform/plans/new`, `/platform/plans/[id]/edit` | Plan form pages | `plans.write` |
| `/platform/support` | Support access requests and sessions, `?request=<tenantId>` opens the request dialog | `support.request` |
| `/platform/data-requests` | GDPR queue, `?view=open\|due_soon\|completed\|rejected\|all`, `?q=` search | `data.requests` |
| `/platform/audit` | Immutable audit log: filters, details, CSV | `audit.read` |
| `/platform/team` | Staff, roles, MFA, invite, disable | `team.manage` |
| `/platform/settings` | Payment provider status, defaults, announcement (D10) | `settings.read` (Save `settings.write`) |

Gates run on the server (`app/(platform)/gate.tsx`): a denied role gets "Access restricted" and none of the page's data
is in the payload. The sidebar, the bell's alerts and the ⌘K index are filtered by the same page map (`PAGE_ACTIONS` in
`permissions.ts`, longest prefix wins); `permissions.test.ts` checks that every nav href has a gate.

## Staff roles (D3)

`features/platform/permissions.ts` is the one map: `staffCan(role, action)` for buttons, `requireStaff(op, action)`
(active member + role) for pages. It mirrors the API's `requirePlatformStaff` roles; the API stays the authority (a refused call is a 403 `platform_forbidden`).

| Action | owner | support | billing | viewer |
| --- | :-: | :-: | :-: | :-: |
| `tenants.read` (list, 360) | ✓ | ✓ | ✓ | ✓ |
| `tenants.suspend` (suspend, reactivate, extend trial) | ✓ | ✓ | | |
| `tenants.modules`, `team.manage`, `settings.read`, `settings.write` | ✓ | | | |
| `billing.read` (metrics) | ✓ | | ✓ | ✓ |
| `support.request` (support grants) | ✓ | ✓ | | |
| `data.requests` (read) | ✓ | ✓ | ✓ | ✓ |
| `audit.read` | ✓ | | | ✓ |
| `tenants.notes`, `tenants.lifecycle`, `billing.write`, `plans.write` (mock pages only) | owner: all; support, billing: notes; billing: billing.write, plans.write | | | |

Owner, and every other staff member, needs two-step verification on every request (the API refuses without it). The API refuses demoting or suspending the last active owner (409 `last_platform_owner`).

## Metrics (D4, `metrics.ts`)

Computed from the subscription event log (`platform/subscriptions.json`: start, upgrade, downgrade, cancel, reactivate,
each with an `mrrDelta`) and invoices, never stored. Months follow the platform clock (`org.today`, Europe/Dublin
wall-clock): `monthKey` slices the ISO string, so an event at 23:30 on the last day counts in that month.

- **MRR series** by month: opening MRR includes events before the window; `new` = start + reactivate, `expansion` =
  upgrades, `contraction` = downgrades (negative), `churn` = cancels (negative). **ARR** = MRR × 12.
- **NRR** (net revenue retention), starting-cohort rule: the cohort is the tenants paying at the end of the month
  before. NRR = (cohort's starting MRR + its upgrades − downgrades − cancels this month) / starting MRR. New tenants
  (and anything in their first month) and reactivations of lapsed tenants are not in the cohort. Null without a base.
- **Logo churn**: cohort tenants that cancelled this month / cohort size (same cohort as NRR).
- **ARPA** = MRR / paying tenants (active + past due). **Trial conversion**: of tenants created in the window that are no
  longer on a trial, the share that ever started paying.
- Numbers (D11): one module, `features/platform/money.ts`. `money` is exact (€149, €149.50, €1,234,567; cents only
  when there are any, built on `lib/money.moneyFormatter` in `en-IE` with the amount's currency) for tables, sheets and
  audit text; `compact` (€12.4k) is for KPI cards, which show the exact `money` value underneath. Cross-tenant totals are in EUR. Deltas ▲/▼ are coloured by
  meaning, not sign.

## Health score (D5, `health.ts`)

`healthScore(tenant, plan, usage, invoices, openSupport)` starts at 100 and subtracts, with one reason per deduction:

| Signal | Points |
| --- | --- |
| Suspended | −50 |
| Past due | −40 |
| Failed invoices | −15 each, at most 2 |
| Users above 95% of the plan's active-user limit | −10 |
| Usage down ≥ 20% (average daily active users, last 30 days vs the 30 before; needs 60 days) | −15 |
| Open support requests | −5 each, at most 3 |

Clamped to 0–100. Bands: Healthy ≥ 70, Watch 40–69, At risk < 40. A tenant with no invoices or usage still scores.
Shown as a pill whose tooltip (and screen-reader text, read once) lists the reasons.

## Store patch contract (`store.ts`)

Slim pages (tenants list, billing ledger, data requests, plans, plan forms, support, team, settings) get only their own rows and never write
the full stores. They write patches and an audit outbox:

- `tenantPatchStore`, `invoicePatchStore`, `dataRequestPatchStore`: `{ [id]: patch }`, newest edit wins.
- `auditOutbox`: new audit lines; ids are counted from `knownAudit()` and re-numbered when folded in (`foldAudit`).
- `subEventOutbox`, `dataRequestOutbox`: new events and requests from the tenant 360, numbered from the highest id its
  server data carries, so they are final.

The support page gets `supportData` (support.ts: tenant names, the requests and, only with `audit.read`, the
`support.*` audit lines; the card is hidden otherwise) and the plan forms `planFormData` (plans.ts: plans and
entitlements). No console page passes the raw seed to the client any more.

Full-record pages (tenant 360) render `applyPatches(rows, patches)` and `foldAudit(audit, outbox)` over
their server data, then fold both into the full stores and clear them. `foldPending()` (store.ts) does the fold: it reads each box from its
store and clears it before folding, so a second call (StrictMode's double mount effect) adds nothing. Slim pages read a full store only as an overlay
when a full page has already loaded it, then apply their own patches on top.

## Sensitive actions (D7)

Suspend/reactivate, plan change, trial extension, credit, refund, void, mark paid, cancel at period end, deletion
scheduling, module override, data-request close, staff role change, disable, settings save, support request and
support revoke. Each needs a reason
(≥ `REASON_MIN` characters, enforced in `sensitiveEntry` as well as the dialog) and writes
`{actor, staffRole, action, target, before, after, reason, at}`. Destructive ones (suspend, refund, void, cancel, deletion,
slug change, module revoke, plan archive) also need the tenant slug typed (`SlugConfirmDialog`); staff disable types the
member's email. Revoking support access only takes a reason: it removes access, so it is safe to do quickly. Inviting staff writes a plain `staff.invited` line without a reason (it only grants access once
the member accepts and sets up MFA; the role is not owner).

## Privacy (D8)

The console never renders tenant operational data (tasks, reports, members, files). The tenant 360 shows counts,
contacts and admins only; the "Operational data hidden" card stays. Support access (`lib/support-access.ts`) is the only
way in, and needs the tenant's consent. View models (`tenantsData`, `billingData`, `dataRequestsData`, `auditLogData`)
carry only the fields their page shows; the tenants, overview and billing tests assert their key sets.

## ⌘K command palette

The console reuses the global search (`features/search`, `scope="platform"`, own recent searches). Its index is loaded
lazily on the first open by `platformSearchIndex()` (only for active staff whose factor is in order) and filtered on the server by staff role (`search-index.ts`):

- pages (the filtered nav; the unbacked pages are not listed without the mock flag);
- tenants from `GET /v1/platform/tenants` (one page of 100) by name, slug or id (slug and id are hidden keywords);
- actions: "Request support access for …" per live tenant (`support.request`) → `/platform/support?request=<id>`.

Before typing, quick actions show (past due tenants, suspended tenants, support access, data requests), gated by the same page map.

## Mock limitations (the unbacked pages only)

The items below describe the seed-driven pages (plans, invoice ledger, usage, notes, change plan, schedule deletion, the sample overview cards), shown only with `ENABLE_MOCK_MODULES=1`.
The platform announcement shown in the tenant shell is mock too: `lib/platform-notice-data.ts` returns nothing without the flag.

- Console edits live in client stores for this browser tab only. They don't reach tenant apps (the tenant banner reads
  the seed `platform/settings.json`), other operators, or server-computed numbers (overview KPIs, health and MRR are
  computed on the server from the seed until reload).
- A plan price edit changes every tenant's MRR at once; "existing tenants keep their price until renewal" is text only.
- `getPlatformSeed` reads the whole seed per request; pages cut it to their view model before it reaches the client.
- Denied and unknown routes render "Access restricted" / "Tenant not found" with HTTP 200 (unknown tabs 404).
- No real Stripe, email or notifications: "Retry payment" uses the payment-method flag, a rejected request tells nobody.
- Billing summaries assume every invoice is in EUR (the seed is); FX is a backend concern.
