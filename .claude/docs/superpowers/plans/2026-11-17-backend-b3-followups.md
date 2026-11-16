# B3 (billing + platform) — rulings and follow-ups

Branch `feat/backend-b3`, commits 6df05d4..0ac4b73. Every task passed a task review. The opus whole-branch review returned "With fixes"; one fix wave resolved all of its findings, and the scoped re-review was clean.

## Rulings (binding for later phases)

| ID | Ruling | Cost if wrong |
|---|---|---|
| C1 | Persistent platform audit replaces InMemoryAuditSink for platform email and storage. Storage settings routes added. | none |
| C2 | `makeTenant()` defaults to an active business subscription. Trial, grace and 402 tests opt in. | none |
| C3 | NotificationKind `billing` (email on by default). | none |
| C4 | The isolation walker does not walk `/v1/platform/*`. Platform tests cover non-staff → 404 and tenant scoping. | walker gap for platform routes |
| C5 | Route allow-list includes `/webhooks/billing/*` (raw body, signature-authenticated). | none |
| C6 | Support access is read-only at the middleware: non-GET → 403 before handlers. Every request is audited. | — |
| C7 | API key is a separate principal: scopes ∩ the creator's current role, no MFA, no device or idle gate. | — |
| C8 | `/v1/data-requests/*` is exempt from 402. The starter-trial backfill touches no real tenant. | first client's plan must be set in the console before go-live |
| C9 | Ids-only platform tables without RLS: `billing_customers`, `billing_events`, later `support_grant_index`, `api_key_index`. | not covered by the RLS guard |
| C10 | **Plans are flat monthly prices with an activeUsers cap.** Stripe quantity is always 1. Seats are a local cap ≤ plan limit, and `PUT /seats` makes no provider call. MRR = plan price. | per-seat pricing later needs a `billing_model` column |
| C11 | MRR counts only `active` subscriptions. `past_due` is a separate count. | none |
| C12 | When a webhook changes the plan, seats are set to the new plan's activeUsers (up or down). An unknown price → warn, plan unchanged. | an owner's lowered seats reset on plan change |
| C13 | While a tenant is blocked (402), these stay allowed: revoke key, delete or disable webhook (`{active:false}` only), revoke support grant, device untrust, and `POST /v1/data-requests`. | blocked tenants can still queue DSR jobs |
| C14 | A suspended tenant gets no webhook fan-out. Deliveries are deferred (not counted) and the sweep skips it. Invite accept → 404. | — |

Platform audit actor formats: staff = raw user id; `tenant:<userId>`; `system:*`. Tenant audit uses `platform:<staffId>` and `apikey:<id>`.

## Before live Stripe keys (deploy checklist)
- Two concurrent first checkouts can both pass the live-subscription check. Add a conditional claim or an advisory lock on checkout, and alert when a webhook reports a `foreign_subscription`. Today that subscription is ignored even though the customer is charged.
- Set the first client's plan through the platform console (C8).

## Follow-ups (not blocking)
- **Suspension:** the notifications relay still runs for suspended tenants, and `listUserTenants` still lists them. Document what "suspended stops" means: HTTP, keys, grants, webhooks, invites, relay, notifications.
- **Billing:**
  - A trial that expires into blocked sends no notice.
  - `PUT /seats` can't be used after a downgrade below the current member count (confusing 422).
  - Concurrent first insert of an invoice → unique violation, which Stripe's retry heals.
  - A missing local subscription row → 404.
  - The `ensureCustomer` idempotency key varies with its params.
  - Invoice status `open` is never written.
  - `planForPrice` is ambiguous.
  - `trialDays` uses ceil.
  - The 60 s config cache is per process.
  - `incomplete` counts as live for about 23 h.
  - `checkoutSessionId` audit noise.
  - `unknown_price` log noise.
  - past_due sends both the dunning notice and the subscription notice.
- **T3.1:**
  - The last-owner count should exclude erased owners and owners without 2FA.
  - GDPR erasure should suspend the staff row.
  - The email/storage test endpoints are not audited.
  - Platform export GET has no CSRF header.
  - Audit list has no cursor.
  - OpenAPI error responses are missing.
- **T3.2:**
  - Reading a file by id stays open after M4 is removed.
  - Starter tenants can't upload files, which blocks the branding logo (product decision).
  - `plans.json` and the plans table can drift (pick one source).
- **Support grants:**
  - An inactive member who is also staff uses the grant path (document this in the tenant notice).
  - The export/download regex over-blocks.
  - Duplicate `roleGate`: move it to a shared helper.
  - The audit lock serialises every support GET.
  - The audit action catalogue for the FE is missing.
  - The FE page `/settings/support-access` is missing (the notification links to it).
  - The grant list is capped at 200.
- **API keys and webhooks:**
  - `failing_since` never decays.
  - Timing of unknown prefixes.
  - The import-order cycle in `app.ts` (entitlements → audit → permission).
  - Before B4: add a shared `subjectUserId(c)` helper. Own/team-scoped handlers other than `/v1/people` see the apikey id as "me".
  - `redactFields` has no consumers.
  - Deliveries deferred during a long suspension get one attempt after reactivation.
  - Any future member deactivate/remove route must be added to the C13 exemptions in `core/middleware/module.ts`.
