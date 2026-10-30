# Platform console (SaaS admin)

The operator's console for running the SaaS: revenue, tenants, billing, trust and the platform team. Front end only
(mock JSON seed in `public/data/platform/` + client stores), shaped so a backend can implement the same types as its
API contract. Design and decisions D1–D11: `superpowers/specs/2026-10-30-platform-console-design.md`.
Requirements: SRS FR-M0-01, 02, 13, 14, 15, 19; old spec FR-SAAS-06..15 (`requirements/SRS-v1.2-built.md`).

Code: `features/platform/**` (pure logic next to its `*.test.ts`, views in `components/`), routes in `app/(platform)/**`,
the ⌘K index action in `app/actions/platform-search.ts`. Only the session role with `platform: true` gets in; everyone
else sees "Access restricted" without the console's nav, alerts or search.

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
(active member + role) for pages. The operator comes from `platform/staff.json` (`operatorId`); the dev-only
`od-staff-role` cookie overrides the role for testing.

| Action | owner | support | billing | viewer |
| --- | :-: | :-: | :-: | :-: |
| `tenants.read` | ✓ | ✓ | ✓ | ✓ |
| `tenants.notes` | ✓ | ✓ | ✓ | |
| `tenants.suspend`, `tenants.lifecycle`, `tenants.modules` | ✓ | | | |
| `billing.read` | ✓ | | ✓ | ✓ |
| `billing.write`, `plans.write` | ✓ | | ✓ | |
| `support.request`, `data.requests` | ✓ | ✓ | | |
| `audit.read` | ✓ | | | ✓ |
| `team.manage`, `settings.write` | ✓ | | | |
| `settings.read` | ✓ | ✓ | ✓ | ✓ |

Viewer gets every `*.read` action and nothing else. Owner needs two-step verification (MFA); the last active owner
can't be demoted or disabled (`team.ts`).

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
lazily on the first open by `platformSearchIndex()` and filtered on the server by staff role (`search-index.ts`):

- pages (the filtered nav);
- tenants by name, subdomain, slug or id (slug and id are hidden keywords);
- invoices by number (only with `billing.read`) → `/platform/billing?q=<number>`;
- support requests and data requests (→ `/platform/data-requests?view=all&q=<id>`);
- staff (`team.manage`);
- actions: "Request support access for …" per tenant (`support.request`) → `/platform/support?request=<id>`.

Before typing, quick actions show (at-risk tenants, failed payments, new plan, support requests, data requests due soon),
gated by the same page map.

## Mock limitations (backend later)

- Console edits live in client stores for this browser tab only. They don't reach tenant apps (the tenant banner reads
  the seed `platform/settings.json`), other operators, or server-computed numbers (overview KPIs, health and MRR are
  computed on the server from the seed until reload).
- A plan price edit changes every tenant's MRR at once; "existing tenants keep their price until renewal" is text only.
- `getPlatformSeed` reads the whole seed per request; pages cut it to their view model before it reaches the client.
- Denied and unknown routes render "Access restricted" / "Tenant not found" with HTTP 200 (unknown tabs 404).
- No real Stripe, email or notifications: "Retry payment" uses the payment-method flag, a rejected request tells nobody.
- Billing summaries assume every invoice is in EUR (the seed is); FX is a backend concern.
