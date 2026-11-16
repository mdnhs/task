# Backend B3: Billing, Entitlements and Platform Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell and run the SaaS: platform staff accounts with a persistent platform audit log, plans/entitlements/seats/trials enforced by the API, Stripe billing behind a provider-agnostic interface with idempotent webhooks, the platform console API (tenants, tenant 360, lifecycle, metrics, support access, platform email/billing settings, data requests), and per-tenant API keys with outgoing webhooks.

**Architecture:** Platform-level tables (no `tenant_id`, no RLS) hold staff, plans and provider config; tenant-level billing tables follow the R8 RLS template. Platform routes live under `/v1/platform/*` behind `requirePlatformStaff(roles)` which demands Better Auth sign-in, `mfa_passed = true` on the session, and an active `platform_staff` row. Platform staff never read tenant data except through a time-boxed, read-only, audited support grant. Billing logic talks only to `BillingProvider`; `StripeBillingProvider` is one implementation and `FakeBillingProvider` drives tests. Entitlements reuse `@opsdesk/domain/entitlements` (`resolveEntitlements`, `effectiveModules`).

**Tech Stack:** existing stack + B2 (event bus, notifications, queue) + `stripe` npm SDK (mocked in tests with `vi.mock`; webhook signatures verified with the SDK's `webhooks.constructEvent` against a test secret).

**Spec:** `.claude/docs/requirements/SRS.md` §2.2 (platform super admin row), §4 (FR-M0-14, 15, 17, 19), §14 (NFR-05, NFR-18); Appendix A.2 (platform console scope); roadmap B3; B0+B1 follow-ups `2026-11-16-backend-b0-b1-followups.md` (B3 blocker: in-memory audit sink; platform email routes deferred from T1.1c). **Depends on B2** (event bus, notifications, queue, secret-box v2).

## Global Constraints

- All B2 global constraints apply (404 cross-tenant, problem+json, 422 semantic errors, R8 RLS on tenant tables, R5 examples + isolation `SPECS` entries, audit in the same tx, namespaced locks first / audit lock last, `deps.clock`, no secrets in logs, secret-box v2 with purpose AAD).
- Platform super admin = platform role `owner`. Platform roles: `owner`, `support`, `billing`, `viewer` (public/data/platform/staff.json). Platform staff must have 2FA enrolled and the session must have passed MFA, always (no policy switch).
- "No access to tenant data without a logged support grant" (SRS §2.2): platform routes return aggregates and tenant metadata only; any tenant-data read by staff goes through an active support grant (max 24 h, read-only, every request audited in the tenant's audit log).
- A module not in the tenant's plan is hidden in the UI and refused by the API within **one minute** (FR-M0-15, AC-M0-05): `requireModule` → 403 problem+json `module_not_entitled`; entitlement cache TTL ≤ 60 s, invalidated on change in-process.
- Removing a module never deletes its data; re-enabling restores it (SRS §2).
- Billing money in minor units (integer cents) with ISO currency; never floats.
- Provider webhooks: signature verified on the raw body, idempotent by provider event id, out-of-order safe (newer `created` wins per subscription).
- Self-service cancellation and data export on exit (NFR-18).
- Payment provider secrets are platform-admin managed (same pattern as Resend, T1.1c), sealed with AAD `platform.billing.<provider>.secret_key` / `.webhook_secret`; env `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` only as bootstrap fallback.

## Review Focus

1. **Plan downgrade with live data** — a tenant drops M1A while rosters exist. Expected: M1A routes 403 within 60 s, rows untouched, re-enable restores access. Test: T3.2 `entitlement removal keeps data and blocks within the TTL`.
2. **Duplicate or out-of-order Stripe webhook** — `invoice.paid` delivered twice; `customer.subscription.updated` (older) arrives after a newer one. Expected: one state change, one notification, newest state kept. Test: T3.3 `webhook idempotent and out-of-order safe`.
3. **Seat limit race** — two invites accepted concurrently when one seat is left. Expected: exactly one succeeds, the other 409 `seat_limit`. Test: T3.2 `concurrent accepts respect the seat limit`.
4. **Support grant outliving its purpose** — a grant expires mid-session, or staff try a write with an active grant. Expected: 403 `support_grant_expired` / 405-style 403 `support_read_only`, every attempt audited. Test: T3.5 `expired or write attempts under a support grant are refused and audited`.
5. **Platform role creep** — a `support` staff member calls a billing or email-settings route, or a staff member without passed MFA calls any platform route. Expected: 403 `platform_forbidden` / 401 `mfa_challenge`. Test: T3.1 `platform routes enforce role and MFA`.

---

## File structure

```
api/src/
  core/middleware/{platform.ts,module.ts,api-key.ts}
  core/net/ssrf-guard.ts
  db/schema/{platform,billing,api-keys}.ts
  modules/
    platform-staff/{routes,service,index}.ts
    platform-audit/{record,verify,routes,index}.ts       # hash chain, namespace "platform"
    platform-email/routes.ts                             # (new) routes for T1.1c service
    entitlements/{service,cache,routes,index}.ts
    billing/{provider.ts,stripe-provider.ts,fake-provider.ts,service.ts,webhooks.ts,routes.ts,index.ts}
    platform-console/{tenants,metrics,lifecycle,support-grants,data-requests,routes,index}.ts
    api-keys/{routes,service,index}.ts
    webhooks-out/{routes,service,deliver,index}.ts
  scripts/create-platform-owner.ts                       # CLI: grant platform owner to an existing verified user
```

## Interfaces locked by this plan

```ts
// core/middleware/platform.ts
requirePlatformStaff(...roles: PlatformRole[]): MiddlewareHandler<AppEnv>   // sets c.var.staff = { userId, role }
type PlatformRole = "owner" | "support" | "billing" | "viewer"

// modules/platform-audit (replaces InMemoryAuditSink; same canonical hash as tenant audit, chain id "platform")
recordPlatformAudit(tx: PlatformTx, e: { action: string; entity: string; entityId: string; actorId: string; targetTenantId?: string; before: unknown; after: unknown }, now: Date): Promise<void>
verifyPlatformChain(db: Db): Promise<{ ok: true; head: { seq: number; hash: string } | null } | { ok: false; brokenAt: string }>

// modules/entitlements
tenantEntitlements(db: Db, tenantId: string, now: Date): Promise<TenantEntitlements & { seats: number; status: SubscriptionStatus }>
requireModule(productModule: string): MiddlewareHandler<AppEnv>     // 403 module_not_entitled
invalidateEntitlements(tenantId: string): void
type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "incomplete"

// modules/billing/provider.ts (server-side twin of features/billing/providers/types.ts)
interface BillingProvider {
  readonly id: "stripe" | "fake"
  ensureCustomer(i: { tenantId: string; email: string; name: string }): Promise<{ customerId: string }>
  createCheckout(i: { customerId: string; priceId: string; seats: number; successUrl: string; cancelUrl: string; trialDays?: number }): Promise<{ url: string; sessionId: string }>
  createPortal(i: { customerId: string; returnUrl: string }): Promise<{ url: string }>
  cancelAtPeriodEnd(i: { subscriptionId: string }): Promise<void>
  resume(i: { subscriptionId: string }): Promise<void>
  updateSeats(i: { subscriptionId: string; seats: number }): Promise<void>
  parseWebhook(rawBody: string, signature: string): BillingEvent       // throws on bad signature
}
type BillingEvent =
  | { kind: "subscription.updated"; providerEventId: string; createdAt: Date; subscriptionId: string; customerId: string; status: SubscriptionStatus; priceId: string; seats: number; currentPeriodEnd: Date; cancelAtPeriodEnd: boolean; trialEnd: Date | null }
  | { kind: "invoice.paid" | "invoice.payment_failed"; providerEventId: string; createdAt: Date; invoiceId: string; customerId: string; amountMinor: number; currency: string; hostedUrl: string | null; periodStart: Date; periodEnd: Date }
  | { kind: "ignored"; providerEventId: string; type: string }
```

---

### Task T3.1: Platform staff, platform audit, platform email routes

**Files:** Create `db/schema/platform.ts` + migration: `platform_staff(user_id pk → user.id, role, status 'active'|'suspended', added_by, added_at)`, `platform_audit_events(id, seq bigint unique, at, actor_id, action, entity, entity_id, target_tenant_id null, before jsonb, after jsonb, prev_hash, hash)` (app_user SELECT+INSERT only); `core/middleware/platform.ts`; `modules/platform-staff/*`; `modules/platform-audit/*`; `modules/platform-email/routes.ts`; `scripts/create-platform-owner.ts`. Modify `modules/platform-email/service.ts`: remove `InMemoryAuditSink` from `index.ts` exports (move to test helpers), write settings + platform audit in one transaction.

**Interfaces:** Produces `requirePlatformStaff`, `recordPlatformAudit`, `verifyPlatformChain`; routes `GET/POST/PATCH /v1/platform/staff` (owner), `GET /v1/platform/audit` + `/export` (owner, viewer read), `GET/PUT /v1/platform/settings/email`, `POST /v1/platform/settings/email/test` (owner).

- [ ] **Step 1: Failing tests**

```ts
test("platform routes enforce role and MFA", async () => {                        // Review Focus #5
  expect((await call(app, "PUT", "/v1/platform/settings/email", { cookie: support, body })).status).toBe(403)
  expect((await call(app, "GET", "/v1/platform/staff", { cookie: ownerNoMfaPass })).status).toBe(401)
})
test("a tenant owner who is not platform staff gets 404 on every /v1/platform route (no existence oracle)", async () => {})
test("email settings PUT seals the key, returns keyLast4 only, and writes platform.email_settings.updated in the same tx", async () => {})
test("platform audit chain verifies and detects a tampered row", async () => {})
test("InMemoryAuditSink is no longer exported from platform-email", () => { expect(Object.keys(platformEmail)).not.toContain("InMemoryAuditSink") })
test("create-platform-owner script refuses unverified users and users without 2FA", async () => {})
test("last active platform owner cannot be demoted or suspended (409 last_platform_owner)", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL; implement (platform audit reuses `canonicalJson` + chain helper with a dedicated advisory lock namespace); PASS; commit `feat(api): platform staff, persistent platform audit and email settings routes`

### Task T3.2: Plans, subscriptions, entitlements, seats, trials, `requireModule`

**Files:** `db/schema/billing.ts` + migration: `plans(id text pk, name, price_monthly_minor int, currency, trial_days, limits jsonb, provider_price_ids jsonb, active bool)` (platform, seeded from `public/data/billing/plans.json` with `priceMonthly*100`); `subscriptions(tenant_id pk, plan_id, status, seats, trial_ends_at, current_period_end, cancel_at_period_end, provider, provider_customer_id, provider_subscription_id, updated_from_event_at)` RLS; `module_overrides(tenant_id, module, mode 'grant'|'revoke', reason, set_by, set_at, pk(tenant_id, module))` RLS. `modules/entitlements/*`, `core/middleware/module.ts`. Modify tenant creation (T1.3) to start a trial on `defaultPlan` with `trial_days`; modify invite accept to enforce seats.

**Interfaces:** Produces `tenantEntitlements`, `requireModule`, `invalidateEntitlements`; `GET /v1/entitlements` (any member: `{ planId, status, modules, seats, seatsUsed, trialEndsAt }`). Seats = active memberships; `seats` from subscription (trial: plan `limits.activeUsers`).

- [ ] **Step 1: Failing tests**

```ts
test("new tenant starts trialing on the default plan with trial_ends_at = created + trialDays", async () => {})
test("requireModule('M1A') → 403 module_not_entitled on starter, 200 on business", async () => {})
test("entitlement removal keeps data and blocks within the TTL", async () => {          // Review Focus #1 / AC-M0-05
  // business → starter override revoke M1A: within 60 s (fake clock) M1A probe 403; rows count unchanged; re-grant → 200
})
test("core modules cannot be revoked by override", async () => {})
test("invite accept beyond seats → 409 seat_limit", async () => {})
test("concurrent accepts respect the seat limit", async () => {})                       // Review Focus #3 (seat lock per tenant)
test("expired trial: writes allowed for 7 days of grace, then non-GET tenant routes → 402 billing_required; GET, billing and export routes stay open", async () => {})
```

Ruling encoded here: trial expiry gives a **7-day grace** (writes allowed, banner via `/v1/entitlements`), then every non-GET tenant route returns **402** problem+json `billing_required` until paid; GETs and billing/export routes stay open (NFR-18 export on exit).

- [ ] **Step 2–5:** Run → FAIL; implement; PASS; commit `feat(api): plans, subscriptions, entitlements, seats and trials`

### Task T3.3: Billing provider, Stripe, checkout/portal/cancel, idempotent webhooks, invoices, dunning

**Files:** `modules/billing/*`; schema + migration: `billing_events(provider, provider_event_id, received_at, kind, tenant_id null, processed_at, pk(provider, provider_event_id))` (platform), `invoices(id, tenant_id, provider_invoice_id unique, amount_minor, currency, status 'paid'|'open'|'failed', hosted_url, period_start, period_end, created_at)` RLS; platform-managed `platform_billing_settings` (singleton: provider, secret_key_ciphertext, webhook_secret_ciphertext, price map) + routes `GET/PUT /v1/platform/settings/billing` (platform owner/billing).

**Interfaces:** Tenant routes (owner only for writes, owner+admin read): `GET /v1/billing/subscription`, `POST /v1/billing/checkout { planId, seats }` → `{ url }`, `POST /v1/billing/portal` → `{ url }`, `POST /v1/billing/cancel`, `POST /v1/billing/resume`, `PUT /v1/billing/seats { seats }`, `GET /v1/billing/invoices`. Webhook `POST /webhooks/billing/stripe` (outside `/v1`, raw body, no session). Events published: `billing.payment_failed`, `billing.subscription_changed` → notifications to owners (B2).

- [ ] **Step 1: Failing tests**

```ts
test("checkout requires owner; admin gets 403 forbidden; success/cancel URLs are APP_URL-based", async () => {})
test("webhook with a bad signature → 400 invalid_signature and nothing stored", async () => {})
test("webhook idempotent and out-of-order safe", async () => {                          // Review Focus #2
  await post(evt("invoice.paid", "evt_1")); await post(evt("invoice.paid", "evt_1"))
  expect(await invoicesOf(A)).toHaveLength(1); expect(notificationsOf(owner)).toHaveLength(1)
  await post(subUpdated("evt_new", { createdAt: t2, status: "active" })); await post(subUpdated("evt_old", { createdAt: t1, status: "past_due" }))
  expect((await subscriptionOf(A)).status).toBe("active")
})
test("invoice.payment_failed → status past_due, owners notified, dunning email once per invoice", async () => {})
test("subscription.updated changes plan → entitlements invalidated immediately", async () => {})
test("cancel sets cancel_at_period_end; resume clears it; both audited", async () => {})
test("unknown event types are recorded as ignored and return 200", async () => {})
test("platform billing settings never return secrets; seal with AAD platform.billing.stripe.*", async () => {})
test("amounts stored as integer minor units; currency from provider, never assumed", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL; implement (`StripeBillingProvider` maps Stripe objects → `BillingEvent`; webhook handler: insert `billing_events` ON CONFLICT DO NOTHING → if inserted, apply in the same tx; subscription updates apply only if `createdAt > updated_from_event_at`); PASS (+ SPECS for tenant billing routes without path params need none); commit `feat(api): stripe billing behind provider interface with idempotent webhooks`

### Task T3.4: Platform console API — tenants, tenant 360, lifecycle, metrics, data requests

**Files:** `modules/platform-console/{tenants,metrics,lifecycle,data-requests,routes}.ts`.

**Interfaces:** `GET /v1/platform/tenants?q&status&plan&page` (viewer+), `GET /v1/platform/tenants/{tenantId}` (360: metadata, subscription, seats used, module overrides, member count, last activity date, open data requests count — **aggregates only**, no member names/emails), lifecycle (owner/support with reason, audited in platform audit **and** the tenant audit as actor `platform:<staffId>`): `POST …/{tenantId}/suspend`, `/reactivate`, `/extend-trial { days ≤ 30 }`, `PUT …/{tenantId}/modules { overrides }` (owner), `GET /v1/platform/metrics` (MRR/ARR from active subscriptions × price in minor units per currency, trials count, churn last 30 days, past_due count; billing/owner/viewer), `GET /v1/platform/data-requests` (cross-tenant list of GDPR requests: tenant, kind, status, due — no subject identity).

- [ ] **Step 1: Failing tests**

```ts
test("tenant list and 360 contain no member names, emails or tenant business data", async () => {})
test("suspend makes every tenant route 404 for members and is audited in both chains", async () => {})
test("module override changes entitlements within the TTL and is audited with before/after", async () => {})
test("metrics: MRR sums active subscriptions per currency in minor units; trials excluded; churn counts cancellations in the last 30 days", async () => {})
test("platform data-requests list shows overdue first and never the subject identity", async () => {})
test("unknown tenantId → 404 tenant_not_found", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL; implement; PASS; commit `feat(api): platform console tenants, lifecycle, metrics and data requests`

### Task T3.5: Support access grants (read-only, time-boxed, audited)

**Files:** `modules/platform-console/support-grants.ts`; schema + migration `support_grants(id, tenant_id, staff_user_id, reason, granted_by, starts_at, expires_at, revoked_at)` RLS (tenant can list its own grants); modify `requireTenant` to accept a staff session for tenant `T` **only** with an active grant (no membership), setting `c.var.member = { roleKey: "support", … }` with a synthetic read-only role (`auditor`-like access from roles.json).

**Interfaces:** `POST /v1/platform/tenants/{tenantId}/support-grants { reason, hours ≤ 24 }` (platform owner/support; support needs owner approval? → ruling: support creates, tenant owners are notified immediately and can revoke; platform owner can revoke), `DELETE /v1/platform/support-grants/{id}`, tenant-side `GET /v1/settings/support-grants`, `DELETE /v1/settings/support-grants/{id}` (tenant owner revokes).

- [ ] **Step 1: Failing tests**

```ts
test("staff without an active grant get 404 on every tenant route of that tenant", async () => {})
test("with an active grant staff can GET tenant routes; every request writes support.access to the tenant audit", async () => {})
test("expired or write attempts under a support grant are refused and audited", async () => {})   // Review Focus #4
test("tenant owner is notified on grant creation and can revoke; revoked grant stops access on the next request", async () => {})
test("grant hours > 24 → 422; reason required", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL; implement; PASS (+ SPECS for grant routes); commit `feat(api): audited read-only support access grants`

### Task T3.6: Per-tenant API keys and outgoing webhooks (FR-M0-17, Should)

**Files:** `modules/api-keys/*`, `core/middleware/api-key.ts`, `modules/webhooks-out/*`, `core/net/ssrf-guard.ts`; schema + migration: `api_keys(id, tenant_id, name, prefix, key_hash, scopes text[], created_by, created_at, last_used_at, revoked_at)` RLS; `webhook_endpoints(id, tenant_id, url, secret_ciphertext, events text[], active, created_by)` RLS; `webhook_deliveries(id, tenant_id, endpoint_id, event_id, status, attempts, next_attempt_at, last_status_code)` RLS.

**Interfaces:** `POST /v1/api-keys { name, scopes }` → key shown once (`odk_<prefix>_<secret>`, sha256 stored), `GET`, `DELETE /v1/api-keys/{id}` (settings:write). `Authorization: Bearer odk_…` authenticates `/v1` tenant routes as a non-human actor whose permissions = intersection of scopes (`<module>:read|write`) and the creator's role at use time; MFA/device gates don't apply; idle timeout n/a; audited actor `apikey:<id>`. Webhooks: `POST/GET/PATCH/DELETE /v1/webhooks`, subscribe to event bus types; deliveries signed `X-OpsDesk-Signature: t=<ts>,v1=<hmac_sha256(secret, ts.body)>`, retries with exponential backoff (max 8, 24 h), auto-disable after 3 days failing; SSRF guard rejects private/loopback/link-local/metadata IPs at create **and** at delivery (DNS re-resolved).

- [ ] **Step 1: Failing tests**

```ts
test("api key shown once; only hash stored; revoked key → 401 invalid_api_key", async () => {})
test("api key scope tasks:read cannot write; scopes cannot exceed the creator's role", async () => {})
test("api key from tenant A with X-Tenant B → 404 (key is bound to its tenant; header ignored or must match)", async () => {})
test("webhook URL to 127.0.0.1, 10.0.0.0/8, 169.254.169.254 or a hostname resolving there → 422 unsafe_webhook_url", async () => {})
test("delivery carries a verifiable HMAC signature and retries with backoff on 5xx", async () => {})
test("endpoint and key ids from another tenant → 404", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL; implement; PASS (+ SPECS); commit `feat(api): tenant api keys and signed outgoing webhooks`

---

## Done criteria for B3

- AC-M0-05 passes (module removal → 403 within 60 s, data kept). FR-M0-14, 15, 17, 19 (platform view) covered; NFR-18 self-service cancel + export on exit.
- Platform console API complete for the existing web platform pages (`app/(platform)/platform/*`); no tenant data reachable by staff without an active grant.
- B0+B1 B3-blockers closed: persistent platform audit in the same tx; platform email routes; `InMemoryAuditSink` not exported.
- Isolation walker green with every new path-param route in `SPECS`.
