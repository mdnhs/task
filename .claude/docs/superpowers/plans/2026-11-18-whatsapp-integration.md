# WhatsApp Notification Integration (outbound only) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **Read the relevant guide in `node_modules/next/dist/docs/` before any web (Next) change** (AGENTS.md). Each task ends with an independently testable deliverable and its own commit; keep two commits for two tasks, never fold work into a neighbour. **This plan is saved now and BUILT LATER: it starts only after B8 to B11 are finished and their notification kinds are final (see Dependencies). Nothing here is built, registered, submitted or sent while writing the plan.**

**Goal:** Let each user receive selected notifications on their own WhatsApp number, according to their access scope: a WhatsApp card in Settings → Integrations (next to Google Drive, today "Not connected / Connect, 0 of 1 connected"), a per-user opt-in with a verified phone number, a per-kind channel choice, a provider-agnostic `MessagingProvider` with the WhatsApp Business Cloud API (Meta) as first adapter and a fake adapter for tests and demo, a delivery ledger with status callbacks and opt-out replies, plan limits and usage metering, GDPR handling, and observability. It is a **new channel of the existing notification pipeline**, never a second pipeline.

**Architecture:** `whatsapp` is a third external channel next to `email` and `push` inside `api/src/modules/notifications` (same `notifications` + `notification_deliveries` ledger, same `notify()` fan-out, same `notification.send` job, same quiet hours, same exactly-once claim/lease and `MAX_ATTEMPTS` backoff). New code lives in `api/src/core/messaging/` (provider interface, Meta adapter, fake adapter, template registry, signature verification) and `api/src/modules/messaging/` (connection, user channels, consent, verification, webhook inbox, usage, routes). Secrets are sealed with `core/crypto/secret-box` (SECRETS_KEY keyring, AAD per owner). Everything tenant-owned has `tenant_id` and the R8 RLS template with hand-appended `FORCE ROW LEVEL SECURITY`.

**Tech Stack:** Hono + `@hono/zod-openapi`, Drizzle + Postgres 16 (RLS), BullMQ/Redis, Vitest + Testcontainers (api), Next.js 16 (web, BFF), Playwright. No new runtime dependency is planned (Meta Graph API is plain HTTPS through the existing `core/net` pinned/SSRF-guarded client).

**Spec:** `.claude/docs/requirements/SRS.md` (FR-M0-11 notifications; the Appendix A rows say "WhatsApp channel not in this SRS" and that WhatsApp stays as a notification channel and Settings integration per the product-owner note of 12 Nov 2026: a BA addendum is Task 1; FR-M0-14/15 billing and entitlements; FR-M0-20 plan data), `.claude/docs/features/settings.md` (Integrations), `.claude/docs/deploy/` (migrations.md, runbook-go-live.md), plans `2026-11-18-backend-b7-hardening.md` (rate limits, log redaction, security checklist) and `2026-11-18-backend-b8-rostering.md` (roster events and scope rules).

## What is NOT in this plan (do not build)

- **No inbound WhatsApp inbox, conversations or two-way chat.** The inbox (`/whatsapp`) was removed on 2026-11-12 and must not return. The only inbound traffic accepted is the provider's **delivery-status callbacks** and **opt-out keywords** (STOP etc.). Verification codes are sent out and typed into the web app (no reply path). Any other inbound message is dropped after the signature check: not stored, not answered, counted in a metric.
- No media, no marketing/promotional templates (utility and authentication categories only), no group messages, no WhatsApp login, no payment.
- No change to in-app/email/push behaviour (they are the fallback and must stay byte-for-byte unchanged when WhatsApp is off).
- No live provider action in development or CI. Meta business verification, number registration and template submission are **manual owner steps** (checklist below).

## Rulings (binding for this feature)

| ID | Ruling | Why | Cost if wrong |
|---|---|---|---|
| W-1 | **Channel, not pipeline.** `whatsapp` is added to `ChannelPrefs` (`{ inApp, email, push, whatsapp }`), to `notification_deliveries.channel`, to `notify()`'s channel list and to the `notification.send` job's channel switch. Everything else (quiet hours, `held`, claim/lease, `skipped`, attempts, backoff, the `security` rules) is reused. | One pipeline means one set of exactly-once and erasure rules. | A parallel pipeline doubles every future fix. |
| W-2 | **`MessagingProvider` interface** in `core/messaging/provider.ts`: `sendTemplate({to, template, language, variables, idempotencyKey}) -> {providerMessageId}`; `parseWebhook(rawBody, headers) -> verified events (status, optOut, ignored)`; `verifySignature`; `checkTemplates() -> approval status per template`; `health()`. Adapters: `meta-cloud` (first), `fake` (tests and local demo: records messages, simulates status callbacks and opt-outs, never opens a socket), later `twilio` (same interface, no schema change). The provider id is a column, not a code branch outside the adapter. Mirrors the billing `BillingProvider` pattern (fake provider in tests, never live). | FR-M0-14 style pluggability; the owner may change BSP. | Rewriting call sites if the interface leaks Meta shapes. |
| W-3 | **Account model (recommended): one platform-owned WhatsApp Business Account and number (model P) with a per-tenant switch.** The tenant's Integrations card then means "Turn on WhatsApp for my company" (no Meta login), plus status, last event and a test message. Model T (each tenant brings its own WABA via Embedded Signup, tenant-sealed token, tenant-owned templates and quality rating) is allowed for by a `connection_mode` column but NOT built in v1. Owner decides (Open decision 2). | Model P: one verified business, one template set approved once, the platform controls quality, no Meta Business Manager knowledge needed by tenants. Model T: tenant brand as sender and own quota, but every tenant must pass Meta verification, templates multiply, support load explodes. | Model P ties all tenants to one quality rating (one abusive tenant can hurt the number): mitigated by per-tenant rate limits, plan caps and a per-tenant and a global kill switch (Tasks 5, 13, 16). |
| W-4 | **Secrets.** Model P: access token, app secret (webhook HMAC key), phone-number id, WABA id and verify token are **platform-managed secrets** in the platform console, sealed with SECRETS_KEY exactly like Stripe/Resend/R2 (AAD `platform:messaging:<provider>`), never returned by any route (only `configured: true` and last 4 of the ids), never logged (values added to the logger's by-value scrub list). Model T would add tenant-sealed rows in `integration_connections` (AAD `integration:<tenant>:whatsapp`). | Same handling as every other secret; B7 secrets checklist. | A leak means rotating one token; rotation is a console action (Task 5). |
| W-5 | **Consent is per user, explicit, recorded, versioned.** No message (including the verification code) is sent to a number before the user starts verification, and no notification before `opted_in_at` is set. Consent event rows are append-only: `{user, tenant, action opt_in/opt_out/verify_sent/verified/removed, source web/stop_reply/erasure, text_version, ip hash, at}`; each is also written to the hash-chained audit with an HMAC reference for the number (never the number). An admin cannot opt a user in; an admin can only disable the channel for the tenant or per kind. | GDPR Art 6(1)(a) and 7, ePrivacy Art 13, Meta policy. | Fines and a banned number. |
| W-6 | **Verification** = a one-time 6-digit code sent as an `authentication` template to the entered E.164 number; stored hashed with a per-row salt, 10-minute TTL, 5 attempts per code, resend cooldown 60 s, at most 5 sends per number per 24 h and 3 numbers per user per day, per-IP and per-tenant limits via the B7 shared rate limiter; the attempt-cap logic reuses the TOTP helper. A number already verified by another user gets the **same response and timing** as a fresh number (no enumeration) and nothing is sent to it. Changing the number clears `verified_at`. | Proves ownership (typo and SIM-swap defence), prevents spamming strangers. | Spam complaints lower the Meta quality rating. |
| W-7 | **User-scope rule (what goes to WhatsApp).** A user receives a WhatsApp message for a notification **only if** (a) the in-app notification for that user was created (recipients and scope filtering are already applied by the module that calls `notify`, which only notifies people who may see the item: `taskScopeWhere`, roster location scope, `hidden = count only`), (b) the kind's channel resolves `whatsapp = true` for the user (user choice, bounded by the tenant default and the admin per-kind switch), (c) the user has a verified, opted-in number, (d) the tenant has WhatsApp enabled and entitled, (e) the kind maps to an approved template. WhatsApp never widens the audience. | The scope model stays the single source of who may know what. | A second recipient computation would drift and leak. |
| W-8 | **Generic bodies only.** Template variables are limited to typed kinds: a neutral **label** (a fixed word such as "task", "report", "roster"), a **count**, a **link** (a short opaque `/n/<id>` path that resolves to the in-app notification after login) and, for verification only, a **code**. No task titles, site names, person names or hidden identities ever reach Meta. Notification bodies carrying the `{{subject}}` token (`SUBJECT_TOKEN`) are never expanded for WhatsApp. Hidden-site/hidden-task items use the same generic text, so a message is not a leak. | PII minimisation toward a third-party processor; B8 R8-4 / AC-M0-01. | Titles at Meta would be a GDPR and contractual problem. |
| W-9 | **No duplicate cross-channel sends by default.** WhatsApp is **off by default for every kind** (opt-in per kind). Tenant setting `messaging.dedupe` (default `prefer_whatsapp`): for the non-critical set (task, report, roster), a queued/held email for the same notification is skipped `duplicate_channel` only after the WhatsApp delivery is `delivered`, or still `sent` after a 2-minute window passes with no failure; `security` and `billing` always go on every enabled channel. The UI shows "also sent by email" when both are on. | Do not spam; keep security reliable. | A missed email if WhatsApp says delivered but the user never sees it: the 2-minute/delivered rule and the runbook cover it. |
| W-10 | **Immediate with quiet hours; burst collapse.** v1 is immediate, reusing `quiet-hours.ts` (the user's window in the tenant timezone, `held` until the window ends). More than a threshold (default 3) of WhatsApp messages to one user in 10 minutes collapse into one `updates_digest` template (count + link). `security` ignores both. | WhatsApp is intrusive; Meta tracks block and report rates. | Over-collapsing hides urgency: the threshold is a tenant setting. |
| W-11 | **Fail open.** The WhatsApp send is a job. A provider outage, unapproved template, exhausted quota, open circuit breaker or kill switch marks only the WhatsApp delivery `failed` or `skipped` with a safe code and **never** blocks, delays or errors the in-app/email/push of the same notification or the business mutation that triggered it. `notify()` only inserts rows and enqueues; it never calls the provider. | Existing notification contract. | none |
| W-12 | **Templates are a registry in code** (`core/messaging/templates.ts`): key, category, language, typed variables, body text (for the owner's Meta submission and for tests) and a kind mapping. A platform-level table `messaging_template_status` (no `tenant_id`, in `TABLE_EXEMPT` with a reason) holds approval status synced by `checkTemplates()` (daily job and a console button). A template that is not `approved` is never sent: the delivery is `skipped: template_not_approved` and the console shows a banner. A changed body after approval gets a new key version (`task_assigned_v2`). | Meta rejects unapproved templates and counts failures against quality. | none |
| W-13 | **The delivery ledger is the notification ledger.** `notification_deliveries` gains `provider`, `provider_message_id`, `provider_status`, `error_code`, `delivered_at`, `read_at`. A `messaging_events` inbox stores parsed status callbacks idempotently by `(provider, provider_event_id)` (raw payload not stored) so a callback arriving before the send job finishes is reconciled later. The idempotency key sent to the provider is the delivery id; a retry after a crash first checks `provider_message_id`. Retries reuse `MAX_ATTEMPTS` and `backoffMs`; terminal failures are dead letters visible in the delivery log (`failed` + safe code), never silently dropped. | Exactly-once from the app's side; Meta has no true idempotency header. | A crash between provider accept and ledger write can double-send once: documented, mitigated by a reconcile sweep. |
| W-14 | **Entitlement and metering.** New plan flags `messaging.whatsapp` and `messaging.whatsapp_monthly_cap` (plan data, FR-M0-20, one source of truth with the platform plan editor). Usage is counted per tenant per month and category at send time; at 80% the tenant admins get one in-app `billing` notice, at 100% WhatsApp sends become `skipped: quota_exceeded` (other channels continue). Meta's per-conversation price is a platform cost; pass-through is an owner decision (Open decision 4). | Cost control; protects the shared number's quality. | none |
| W-15 | **Processor and residency.** Phone numbers and generic message text go to Meta (WhatsApp Business Platform). Meta is added to the subprocessor list and the DPA annex (Task 21). At rest, numbers are sealed (secret-box, AAD per user) with an HMAC for uniqueness lookup (same pattern as `emailHmac`). | Data minimisation, transfer assessment. | Owner and legal sign-off needed (Open decision 6). |
| W-16 | **Flag and rollout.** Env `MESSAGING_PROVIDER=fake|meta` (default `fake` outside production; production with `fake` or without credentials means the Integrations card shows "Not available" and readiness reports it). Per-tenant `messaging_settings.enabled` defaults false. The platform console has a global kill switch. | Staged rollout, no accidental live sends. | none |
| W-17 | **Order is by risk:** schema and RLS (2), provider core and fakes (3, 4), platform secrets (5), consent and verification (6, 7), templates (8), prefs (9), pipeline (10, 11), webhook (12), limits and metering (13), card API (14), GDPR (15), observability (16), then web (17 to 20), docs (21), rollout (22), security (23), gate (24). | A consent or scope bug is a legal problem; a skeleton is not. | none |

## Global Constraints

- All B0 to B11 constraints hold: problem+json everywhere; cross-tenant id answers 404 (never 403); plan not entitled 403 `module_not_entitled`; unpaid 402 on non-GET; `409 retry` once; `deps.clock` is the only clock (`new Date()`/`Date.now()` banned in the new modules, source-grep test); R8 RLS template on every new tenant table with `FORCE ROW LEVEL SECURITY` appended by hand; every JSON body has `.openapi({ example })`; audit for every security-relevant write; Postgres 16.
- **Migrations** are numbered after the last B11 migration, run as `app_owner`, additive. Every migration touching FORCE RLS tables is tested by running the **real SQL as app_owner without tenant context** (0040/0041 lesson); backfills loop tenants with `set_config('app.tenant_id', id, true)`, reset it to `''` after the loop and assert counts over more than one tenant.
- **Isolation (T7.1 gate):** every new route is added to `api/test/route-classification.ts` in the same commit; path-param routes get `ROUTE_PARAMS`/`SPECS` fixtures with a tenant-B id; every new tenant table goes in `HASHED_TABLES` (`api/test/isolation-tables.ts`); the webhook route is classified **public + signature-verified** (own class, tested); platform routes in the platform class.
- **Logs and PII:** phone numbers (`to`, `phone`, `msisdn`, `wa_id`, any E.164-looking value), verification codes, tokens and template variables are never logged. Add the keys to `LOG_REDACT_PATHS`, add secret values to the by-value scrub list, and test that a send, a failed send, a webhook and a verification produce no digits-run of 8+ in captured output. Errors keep only a `safeCode`.
- **No live traffic:** tests use the fake provider only; the Meta adapter is tested against recorded static JSON fixtures and a local stub HTTP server through the SSRF-guarded client; no test or script ever contacts `graph.facebook.com`.
- Never hard-code tenant values (company name, language, timezone, quiet hours, kinds enabled). Template texts are platform-level and neutral (the product name comes from platform config, never a tenant name).
- Web: OpsDesk tokens, borderless, big radius, no shadcn defaults; compact visual UI (icons, numbers, short copy); Hugeicons through the central `Icon` component; hover/disabled/read-only/open states in light and dark; motion tokens, CSS first; every page and component has an exact-match skeleton (`features/<f>/components/skeletons.tsx`, static `loading.tsx` built with `Sk`) updated with the component; features import each other only via `index.ts`.
- After every task: `npm -w api test`, `npm -w api run typecheck`, `npx vitest run`, `npx tsc --noEmit`, `npx eslint .` (no increase over the baseline recorded in Task 1), `npm run api:types:check` (`npm run api:types` when OpenAPI changed), `npm run test:contract` where covered, `npm run build` and `npm run check:bundle` for web tasks.
- Docs: `.claude/docs/features/settings.md` and the notification notes get a WhatsApp section as it goes; the only new `.md` is `.claude/docs/deploy/runbook-whatsapp.md` (Task 21).

## Review Focus

1. **No message without consent and verification**, ever: send job, test message, admin test, retry after opt-out, a callback after opt-out, number change, erasure in flight. Test owners: Tasks 6, 7, 10, 12, 15.
2. **Scope**: a user never gets a WhatsApp message about an item `notify` did not create an in-app row for; hidden site/task items produce the generic template with no identity; no title, name or site in any provider payload. Test owners: Tasks 8, 10.
3. **Fail open and exactly once**: provider down, breaker open, quota exhausted, template unapproved, crash mid-send, duplicate or replayed callbacks: other channels unaffected, one provider message per delivery, ledger consistent. Test owners: Tasks 10, 11, 12.
4. **Secrets and PII**: no route, log, audit row, error body or OpenAPI example contains a token, app secret, code or full number; numbers sealed at rest; the webhook rejects bad/missing signatures with a constant-time compare. Test owners: Tasks 3, 4, 5, 12, 16, 23.
5. **Tenant isolation and RLS**: every new table forced and tested as `app_owner` without tenant context; the webhook resolves the tenant only from our own ledger, never from payload fields. Test owners: Tasks 2, 12, 23.
6. **Abuse and enumeration**: verification cannot be used to spam a number, probe whether a number belongs to a user, or brute-force a code. Test owner: Task 7.

---

## File structure (new or changed, by responsibility)

- `api/src/core/messaging/`: `provider.ts` (interface, event types, errors), `meta-cloud.ts`, `fake-provider.ts`, `templates.ts`, `signature.ts` (X-Hub-Signature-256), `phone.ts` (E.164), `breaker.ts`, `index.ts`.
- `api/src/db/schema/messaging.ts`, `api/src/db/schema/notifications.ts` (channel and ledger columns), `api/src/db/migrations/00NN_messaging.sql` (+ meta).
- `api/src/modules/messaging/`: `connection.ts`, `channels.ts` (user number), `consent.ts`, `verify.ts`, `prefs.ts`, `send.ts` (called from the notification send job), `webhook.ts`, `usage.ts`, `templates-sync.ts`, `routes.ts`, `platform-routes.ts`, `gdpr.ts`, `jobs.ts`, `index.ts`.
- `api/src/modules/notifications/` (`prefs.ts`, `service.ts`, `routes.ts`: additions only), `api/src/modules/platform-console/` (registration), `api/src/modules/entitlements/` + `public/data/billing/` (flag and cap), `api/src/modules/gdpr/` (handler registration), `api/src/core/observability/{logger,metrics,readiness}.ts`.
- `api/test/` (classification, tables, fixtures), `api/src/seed/demo/`.
- Web: the card lives in `features/settings/components/integrations/` beside Google Drive (no new feature); per-user UI in `features/account` (notifications tab); console in `features/platform`; admin view in `features/settings`; `app/actions/messaging.ts`, `e2e/whatsapp.spec.ts`, `e2e/skeletons.spec.ts`.

---

## Part A: API

### Task 1: Pre-flight, SRS addendum and baselines

**Files:** Modify `.claude/docs/requirements/SRS.md` (new FR-M0-WA-1..N: channel, consent, templates, opt-out, metering, plan flag; Appendix A.7 line), `.claude/docs/features/settings.md` (WhatsApp section stub). No code.

**Interfaces:** none. Produces the numbered requirements the later tests cite.

- [ ] **Step 1:** Confirm B8 to B11 are merged and the final `KINDS` list and each kind's recipient rule are frozen; copy them into an SRS table (kind, who gets it, scope rule, WhatsApp eligible yes/no, template key).
- [ ] **Step 2:** Record baselines (root vitest, contract, api, eslint warnings) in the commit message.
- [ ] **Step 3:** Note which owner-checklist items block real-sandbox validation (Tasks 5, 8, 12) and which do not block fake-provider work.
- [ ] **Step 4: Commit** `docs: WhatsApp channel requirements and eligible notification kinds`

### Task 2: Migration: messaging schema with RLS

**Files:** Create `api/src/db/schema/messaging.ts`, migration `00NN_messaging.sql` (+ meta); modify `api/src/db/schema/notifications.ts`, `api/src/db/schema/index.ts`, `api/test/isolation-tables.ts`. Test: `api/src/modules/messaging/schema.test.ts`.

**Interfaces (Produces):**
- `messaging_settings(tenant_id pk, enabled, provider, connection_mode 'platform'|'tenant', default_channels jsonb, kind_switches jsonb, dedupe text, burst_threshold int, updated_by, version, ...)`.
- `user_messaging_channels(id, tenant_id, user_id, channel 'whatsapp', phone_sealed, phone_hmac, phone_last4, verified_at, consent_text_version, opted_in_at, opted_out_at, opt_out_source, locale, ...)`, unique `(tenant_id, user_id, channel)`, unique `(tenant_id, phone_hmac)` where verified and not opted out.
- `messaging_verifications(id, tenant_id, user_id, channel_id, code_hash, salt, expires_at, attempts, sent_count, last_sent_at, consumed_at)`.
- `messaging_consent_events(id, tenant_id, user_id, action, source, text_version, ip_hash, at)` append-only.
- `messaging_events(id, tenant_id null until reconciled, provider, provider_event_id, kind, safe_fields jsonb, received_at, processed_at)` unique `(provider, provider_event_id)`.
- `messaging_usage(tenant_id, period 'YYYY-MM', category, count)` PK `(tenant_id, period, category)`.
- `notification_deliveries`: channel accepts `whatsapp`; add `provider`, `provider_message_id`, `provider_status`, `error_code`, `delivered_at`, `read_at`; index `(provider, provider_message_id)`.
- `messaging_template_status(provider, template_key, language, status, checked_at)` platform-level, no `tenant_id`.

- [ ] **Step 1: Write the failing tests** (Testcontainers):
  - `every new tenant table has RLS enabled and FORCED with the tenant_isolation policy (catalog query)`
  - `app_user without tenant context reads zero rows of each new table`
  - `app_user in tenant A cannot insert a row for tenant B (WITH CHECK)`
  - `unique active phone_hmac per tenant: a second verified user with the same number is rejected; an opted-out or unverified row does not collide`
  - `consent events are append-only for app_user (UPDATE and DELETE are refused)`
  - `migration SQL run as app_owner without tenant context over 3 tenants leaves existing email and push deliveries untouched, counts asserted, app.tenant_id is empty afterwards`
  - `the channel check accepts whatsapp and still rejects an unknown channel`
  - `messaging_template_status is in TABLE_EXEMPT with its reason and the inventory test passes`
- [ ] **Step 2: Run** `npm -w api test -- messaging/schema`, expect FAIL.
- [ ] **Step 3: Implement** schema, SQL with hand-appended FORCE RLS and grants, `HASHED_TABLES` and `TABLE_EXEMPT` updates.
- [ ] **Step 4: Run** the gates including `route-inventory` and `rls-guard`.
- [ ] **Step 5: Commit** `feat(api): messaging schema (settings, user channels, consent events, verifications, event inbox, usage) with RLS`

### Task 3: Provider interface, phone utilities, signature verification, template registry

**Files:** Create `api/src/core/messaging/{provider,phone,signature,templates,index}.ts`. Test: `api/src/core/messaging/messaging-core.test.ts`.

**Interfaces (Produces):** `MessagingProvider` per W-2 with typed errors (`ProviderRateLimited`, `ProviderUnavailable`, `TemplateNotApproved`, `RecipientInvalid`, `RecipientNotOnWhatsApp`, `QualityBlocked`), each with a safe code and a retryable flag. `normalizeE164(input) -> string | null` (shape check: `+`, 8 to 15 digits; the UI always sends a country-code selector; adding a phone library is a decision for Task 3 only if national-format entry is wanted). `verifyMetaSignature(rawBody, header, appSecret) -> boolean` (HMAC-SHA256, `sha256=` prefix, constant-time, rejects missing/short/malformed headers). Registry entries per W-12 (list in Task 8).

- [ ] **Step 1: Failing tests:**
  - `normalizeE164 accepts +353 87 123 4567 style input and rejects 0871234567 without a country code, letters, and more than 15 digits`
  - `verifyMetaSignature accepts a correct signature and rejects a wrong key, a body changed by one byte, a missing header, a header without sha256=`
  - `verifyMetaSignature uses timingSafeEqual (source check) and does not throw on length mismatch`
  - `every registry template has a unique key per language, category utility or authentication, a variable count equal to its body placeholders`
  - `registry variables are typed label, count, link or code only; no type can carry a title, name or site`
  - `each provider error has a safe code matching /^[A-Za-z0-9_.-]{1,64}$/ and a retryable flag`
- [ ] **Step 2: Run**, expect FAIL. **Step 3: Implement.** **Step 4: Run** gates.
- [ ] **Step 5: Commit** `feat(api): messaging provider interface, E.164 helper, webhook signature check and template registry`

### Task 4: Fake adapter, Meta Cloud adapter, circuit breaker

**Files:** Create `api/src/core/messaging/{fake-provider,meta-cloud,breaker}.ts`, fixtures `api/src/core/messaging/fixtures/*.json`; modify `api/src/deps.ts`, `api/src/env.ts`, test helpers (fake in test deps). Test: `api/src/core/messaging/providers.test.ts`.

**Interfaces:** Fake: records `sent[]`, `failNext(error)`, `simulateStatus(id, status)`, `simulateOptOut(number)`, deterministic ids, validates variable counts against the registry as Meta would. Meta adapter: `POST /{phone-number-id}/messages` with a template message, bearer token, through the SSRF-guarded pinned client, 10 s timeout; maps Graph error codes to the typed errors (undeliverable, re-engagement, template missing/paused, rate limit, pair rate limit, invalid token); `checkTemplates()` reads template status. Breaker opens after 5 consecutive retryable failures in 60 s, half-open after 30 s, state exposed to metrics. No retries inside the adapter (the job owns retries).

- [ ] **Step 1: Failing tests:**
  - `fake: a repeated idempotency key returns the same id and records once`
  - `fake: failNext(rate_limited) throws a retryable ProviderRateLimited`
  - `meta: builds the exact template request body from the fixture (language, components, variables) and the token never appears in logs or errors`
  - `meta: recipient-not-on-WhatsApp maps to a non-retryable error, rate-limit to a retryable one, invalid token to ProviderUnavailable with a console alert flag`
  - `meta: a 10 s timeout and a connection reset are retryable`
  - `meta: only the configured Graph host is reachable (SSRF guard) and tests run against the local stub only`
  - `breaker: opens after 5 failures, rejects fast while open, half-open allows one probe, closes on success (injected clock)`
  - `production boot with MESSAGING_PROVIDER=fake fails readiness detail; meta with missing credentials reports not configured (card shows Not available)`
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): fake and Meta Cloud messaging adapters with circuit breaker`

### Task 5: Platform console API for provider secrets

**Files:** Create `api/src/modules/messaging/{platform-routes,connection}.ts`; modify platform-console registration and `api/test/route-classification.ts`. Test: `api/src/modules/messaging/platform.test.ts`.

**Interfaces:** `GET /v1/platform/messaging` -> `{provider, configured, phoneNumberLast4, wabaIdLast4, templatesSynced, killSwitch, health}`; `PUT /v1/platform/messaging/credentials` (sealed, never echoed); `POST /v1/platform/messaging/test` (send a test template to the calling **platform staff member's own verified number** via the active provider; fake in tests); `PUT /v1/platform/messaging/kill-switch`; `POST /v1/platform/messaging/templates/sync`. Platform staff only, same MFA step-up as the Stripe keys, every write in the platform audit.

- [ ] **Step 1: Failing tests:**
  - `credentials are sealed: the DB column holds no plaintext and no GET returns any secret, only configured and last4`
  - `a tenant admin and a non-platform user get 404 on every platform messaging route`
  - `staff without fresh MFA gets the same step-up as the Stripe key route`
  - `every write is in the platform audit with field names but not values`
  - `kill switch on makes every tenant send skip platform_disabled while in-app/email are untouched`
  - `rotating a credential reseals and invalidates the cached client`
  - `secret values never appear in captured logs of these routes (by-value scrub)`
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): platform console routes for messaging credentials, kill switch and template sync`

### Task 6: Consent model and the user number lifecycle

**Files:** Create `api/src/modules/messaging/{channels,consent}.ts`, part of `routes.ts`; classification and fixtures. Test: `api/src/modules/messaging/channels.test.ts`.

**Interfaces:** `GET /v1/me/messaging` -> `{whatsapp: {state none|pending|verified|opted_out, phoneLast4, consentTextVersion, optedInAt}, consentText: {version, text}}`; `PUT /v1/me/messaging/whatsapp/number` (E.164, `acceptConsent: true`, `consentTextVersion`; starts verification, generic reply); `DELETE /v1/me/messaging/whatsapp` (number removed, consent withdrawn, whatsapp preferences cleared); `POST /v1/me/messaging/whatsapp/opt-out` and `/opt-in` (pause without removing; opt-in needs the current consent text version). The consent text lives in platform config with a version; a tenant may append but not shorten it (Open decision 6).

- [ ] **Step 1: Failing tests:**
  - `adding a number without acceptConsent true is 422 consent_required and nothing is stored or sent`
  - `an older consentTextVersion is 409 consent_text_changed`
  - `each lifecycle step writes a consent event (who, when, text_version, ip hash) and an audit row with an HMAC reference, never the number`
  - `the number is sealed; GET returns last4 only; DB and audit hold no plaintext number`
  - `changing the number resets verified_at and opted_in_at and requires a new verification`
  - `delete removes the sealed number and hash but keeps consent events and audit`
  - `a user cannot read or change another user's channel (404); no admin route can set a number or opt a user in`
  - `a tenant without WhatsApp enabled or entitled gets the Task 13 refusal and no code is ever sent`
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): per-user WhatsApp number, consent events and opt-out`

### Task 7: Verification code flow and abuse limits

**Files:** Create `api/src/modules/messaging/verify.ts`; routes `POST /v1/me/messaging/whatsapp/verify/send` and `/confirm`. Test: `api/src/modules/messaging/verify.test.ts`.

**Interfaces:** `send` queues an `authentication` template through the normal delivery ledger as a `security`-class message (ignores quiet hours; records `verify_sent`); `confirm {code}` sets `verified_at` and `opted_in_at`, writes the consent event and audit, sends the welcome template once. Limits per W-6 through the B7 shared limiter; attempt cap reuses the TOTP helper; constant-time hash compare.

- [ ] **Step 1: Failing tests:**
  - `a correct code within 10 minutes verifies; after 10 minutes it is rejected; a consumed code cannot be reused`
  - `5 wrong attempts lock that code until a new one is sent; resend cooldown 60 s (injected clock)`
  - `more than 5 sends to one number in 24 h or 3 numbers per user per day is 429 with Retry-After and no provider call`
  - `no enumeration: a number verified by another user gives the same response and timing class as a fresh number, sends nothing to that other user, logs only a metric`
  - `responses and audit never contain the code or the number`
  - `a code can only be sent to the number the user submitted in this flow`
  - `a provider failure on send leaves the verification resendable and returns a retry message, not a 500`
  - `fake provider end to end: send then confirm sets verified_at`
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): WhatsApp number verification with attempt caps and enumeration-safe responses`

### Task 8: Template set and kind mapping

**Files:** Modify `api/src/core/messaging/templates.ts`; add `api/src/modules/messaging/templates-sync.ts` and job `messaging.templates.sync` (daily). Test: `api/src/modules/messaging/templates.test.ts`.

**Template list** (English `en` only: the product is for an Ireland client, so there is no other language and no language slots; generic typed variables only, W-8):

| Key | Category | Used for | Variables |
|---|---|---|---|
| `verify_code` | authentication | number verification | code |
| `welcome_verified` | utility | verification done | none |
| `task_assigned` | utility | task assigned or changed | label, link |
| `task_due` | utility | task due soon or overdue | count, link |
| `report_due` | utility | report deadline | label, link |
| `report_returned` | utility | report returned or approved | label, link |
| `roster_published` | utility | roster published or changed | label, link |
| `leave_decided` | utility | leave approved or declined | link |
| `billing_notice` | utility | billing | link |
| `security_alert` | utility | security | link |
| `updates_digest` | utility | burst collapse | count, link |

The exact kind-to-template table is finalised in Task 1 from the frozen kinds. A kind without a template is never sent to WhatsApp (`skipped: no_template`). Body texts are drafted in the registry for the owner to paste into Meta (owner checklist item 6).

- [ ] **Step 1: Failing tests:**
  - `every kind in KINDS has a template or an explicit "no WhatsApp" marker (a new kind without a decision fails this test)`
  - `a send for a template whose status is not approved is skipped template_not_approved and never reaches the provider`
  - `sync updates statuses from the fake provider and raises the console banner flag for rejected or paused templates`
  - `a paused template stops sends for that template only`
  - `language falls back to en when the user's locale has no approved template`
  - `variable builder: for every template and kind, the variables contain no title, name, site or email (snapshot over fixture notifications including hidden-site and SUBJECT_TOKEN ones)`
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): WhatsApp template set, kind mapping and approval status sync`

### Task 9: Preferences: per-user per-kind, tenant defaults, admin switch

**Files:** Modify `api/src/modules/notifications/prefs.ts` (`ChannelPrefs.whatsapp`, `resolveChannels`) and `routes.ts` (existing preference routes accept `whatsapp`); create `api/src/modules/messaging/prefs.ts` and admin routes `GET/PUT /v1/settings/messaging`. Test: additions to `notifications.test.ts`, new `prefs.test.ts`.

**Interfaces:** resolution order per kind: admin kind switch off -> false (locked, UI shows why); user override; tenant default; global default false. A user without a verified opted-in number resolves `whatsapp = false` regardless of toggles. `security` keeps its in-app and email guarantees; WhatsApp is additive.

- [ ] **Step 1: Failing tests:**
  - `default: whatsapp is false for every kind and the existing resolveChannels expectations for inApp, email and push are unchanged`
  - `tenant default on plus no user override is on only for users with a verified number`
  - `an admin kind switch off wins over a user override and the tenant default, and the user sees a read-only reason`
  - `security keeps in-app and email always on`
  - `PUT preferences with whatsapp for an unverified user stores the choice but resolves false until verified`
  - `a non-admin cannot read or write /v1/settings/messaging`
  - `tenant settings use version for optimistic concurrency (409 version_conflict)`
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): WhatsApp channel preferences with tenant defaults and admin per-kind switch`

### Task 10: Pipeline integration: `notify()` and the send job

**Files:** Modify `api/src/modules/notifications/service.ts` (channel list and send switch; no behavioural change for email/push); create `api/src/modules/messaging/send.ts`. Test: additions to `notifications.test.ts`, new `send.test.ts`.

**Interfaces:** `notify()` adds `whatsapp` when `ch.whatsapp` and the user has an eligible verified channel; one delivery row (`held` in quiet hours). The send job's claim step loads the sealed number only inside the claim, builds template and variables from the registry (never from the notification body, W-8), applies dedupe (W-9), burst collapse (W-10), quota (W-14), kill switch and breaker (W-11), then calls the provider outside the transaction like email/push. Success writes `provider_message_id` and `provider_status = sent`; retryable failures re-queue with `backoffMs` up to `MAX_ATTEMPTS`; non-retryable errors fail terminally with a code.

- [ ] **Step 1: Failing tests:**
  - `a notification with whatsapp on creates one in-app row, one whatsapp delivery and the email/push deliveries exactly as before`
  - `whatsapp off or unverified: no whatsapp delivery and the other channels are identical to current behaviour`
  - `quiet hours: held with send_after = window end; security ignores quiet hours`
  - `provider outage: retries at 30/60/120/240 s then fails; the in-app row, the email delivery and the triggering mutation are unaffected`
  - `exactly once: running the send job twice for one delivery calls the provider once; a crash after provider accept and before the ledger write is reconciled by provider_message_id on retry (simulated)`
  - `scope: a user not notified in-app (hidden or out of scope) never gets a whatsapp delivery, for task, roster and report fixtures`
  - `payload snapshot: no provider payload contains a task title, site name, person name or the SUBJECT_TOKEN`
  - `opt-out between enqueue and send skips consent_withdrawn and never calls the provider`
  - `dedupe prefer_whatsapp: email skipped duplicate_channel only after WhatsApp is delivered (or 2 min sent); billing and security are never deduped`
  - `burst: the 4th message in 10 minutes collapses into one updates_digest`
  - `breaker open: deliveries skipped provider_unavailable without a call and retried after half-open`
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): WhatsApp as a channel of the notification pipeline (consent, scope, dedupe, fail-open)`

### Task 11: Reconciliation, dead letters and sweeps

**Files:** Create `api/src/modules/messaging/jobs.ts`. Test: `api/src/modules/messaging/jobs.test.ts`.

- [ ] **Step 1: Failing tests:**
  - `a delivery stuck sending past the lease is re-claimed once and never double-sent when provider_message_id exists`
  - `a callback that arrived before the provider id was written is matched when the id is written (late reconcile)`
  - `terminal failures stay visible as failed with a safe code; an admin resend creates a new delivery once and never mutates the old one`
  - `sweep metrics count reconciled, expired and failed deliveries`
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): messaging reconciliation sweep and dead-letter handling`

### Task 12: Webhook (status callbacks and opt-out) and its inbox

**Files:** Create `api/src/modules/messaging/webhook.ts`; routes `GET /v1/webhooks/whatsapp` (verify challenge) and `POST /v1/webhooks/whatsapp`; classification as public + signature. Test: `api/src/modules/messaging/webhook.test.ts`.

**Interfaces:** the POST reads the **raw body** first, verifies `X-Hub-Signature-256` with the platform app secret (401, no detail), caps body size, inserts into `messaging_events` idempotently, answers 200 fast and processes in a job. Replay protection is idempotency by `(provider, event id)` (Meta retries for days, so an age window alone would drop real events; the timestamp only bounds absurd future values). The tenant is found **only** through our ledger (`provider_message_id` -> delivery -> tenant) for statuses, and through `phone_hmac` for opt-out keywords (STOP and a localised list from config), which sets `opted_out_at`, writes a consent event (`source stop_reply`) and audit; a number verified in several tenants is opted out in all. Any other inbound type is dropped and counted. A `failed` status with a "recipient blocked or opted out" code also opts the user out.

- [ ] **Step 1: Failing tests:**
  - `a missing, malformed or wrong signature is 401, writes nothing and logs only a counter`
  - `the signature is checked over the raw bytes (a re-serialised body fails)`
  - `GET challenge with the right verify token echoes it; a wrong token is 403 (constant-time)`
  - `the same status event delivered twice updates once`
  - `delivered then read apply in order; a late delivered after read does not regress the status`
  - `an event for an unknown provider_message_id is stored unreconciled and cannot create or modify any tenant row`
  - `STOP opts the user out in every tenant where that number is verified, records source stop_reply, and the next notification skips consent_withdrawn`
  - `any other inbound message type is dropped: nothing stored, nothing sent, metric incremented`
  - `a payload carrying tenant_id or user_id fields is ignored (tenant comes only from our ledger)`
  - `the route answers 200 within budget with processing deferred; a job failure retries without a second provider call`
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): WhatsApp webhook with signature check, idempotent inbox, status updates and STOP handling`

### Task 13: Entitlement, plan cap and usage metering

**Files:** Modify `public/data/billing/entitlements.json` and plan data (`messaging.whatsapp`, `messaging.whatsapp_monthly_cap`), `api/src/modules/entitlements/data.ts`; create `api/src/modules/messaging/usage.ts`; route `GET /v1/settings/messaging/usage`. Test: `usage.test.ts`, additions to `entitlements.test.ts`.

- [ ] **Step 1: Failing tests:**
  - `a tenant whose plan lacks messaging.whatsapp gets 403 module_not_entitled on card routes and the send job skips not_entitled`
  - `usage counts one per accepted template by category per month (tenant-timezone month boundary, injected clock)`
  - `at 80% the tenant admins get one billing-kind notice per month (ledger, no duplicate); at 100% sends are skipped quota_exceeded while in-app/email continue`
  - `an upgrade lifts the cap immediately; a downgrade mid-month skips new sends over the cap`
  - `the platform plan editor edits the same entitlement data and the plan data schema test passes`
  - `usage is tenant-isolated (RLS) and a platform summary returns totals without numbers or content`
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): WhatsApp entitlement, plan cap and per-tenant usage metering`

### Task 14: Tenant connection routes (the Integrations card API)

**Files:** Routes in `api/src/modules/messaging/routes.ts`: `GET /v1/integrations/whatsapp` (status for the card: `not_available | off | on | degraded`, last event time, templates ready, verified-user count, usage), `POST .../enable`, `POST .../disable`, `POST .../test` (to the calling admin's own verified number only), `GET .../deliveries` (admin delivery log, cursor, filters; display name and last4 only, never full numbers or content). `GET /v1/integrations` lists WhatsApp too ("n of 2 connected"). Same permission as the Google Drive card. Test: `api/src/modules/messaging/card.test.ts`.

- [ ] **Step 1: Failing tests:**
  - `the integrations list returns google and whatsapp; whatsapp connected means enabled, provider configured and at least one approved template`
  - `enable needs the entitlement and a configured provider (409 provider_not_configured with a safe message); disable stops new deliveries, skips queued ones tenant_disabled and keeps user consents`
  - `test goes only to the caller's own verified number (409 verify_first otherwise); a second test within 30 s is 429`
  - `the delivery log returns only the tenant's rows, paginated, with last4 and display name, status and safe error code, no body text or variables`
  - `another tenant's delivery id is 404; a member without the integrations permission gets the same refusal as the Google card`
  - `enable, disable and test are audited and every route is classified with tenant-B fixtures`
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): WhatsApp integration card routes, test message and delivery log`

### Task 15: GDPR export, erasure and retention

**Files:** Create `api/src/modules/messaging/gdpr.ts` (`registerDsrHandler("messaging", ...)`) and a retention job. Test: `gdpr.test.ts`, additions to `api/src/modules/gdpr/gdpr.test.ts`.

**Interfaces:** export returns the subject's own channel state, consent history and delivery rows (kind, status, time); whether the export shows the full number (the subject's own data, decrypted for the subject only) is confirmed with the legal advisor, default last4 plus a note. Erase deletes the sealed number and hash, keeps consent events and audit as legal proof under the erased-user reference (ip hash dropped). Meta has no erase API: documented in the runbook. Delivery rows are purged after 90 days (setting); usage rows keep counts only.

- [ ] **Step 1: Failing tests:**
  - `export contains the user's own whatsapp state and consent history and nothing about other users`
  - `erase removes the sealed number and hash, leaves consent events under the erased-user reference, and the user can no longer receive WhatsApp`
  - `erase with a queued delivery skips it recipient_erased`
  - `retention purges deliveries older than the window (injected clock), once per run`
  - `the registry test that every module holding personal data registers a handler lists messaging`
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): messaging GDPR export, erasure and delivery retention`

### Task 16: Observability, rate limits and readiness

**Files:** Modify `api/src/core/observability/{logger,metrics,readiness}.ts`. Test: `api/src/modules/messaging/observability.test.ts`.

**Interfaces:** metrics `messaging_send_total{status,template}`, `messaging_send_latency_ms`, `messaging_callbacks_total{status}`, `messaging_breaker_state`, `messaging_quota_skipped_total`, `messaging_verify_total{result}`, `messaging_webhook_rejected_total{reason}`; no tenant, user or number labels. Per-tenant send rate limit (default 30 per minute) and a global ceiling below the provider's tier quota, applied in the send job as a deferral, not a failure. Readiness reports messaging config in its detail but never makes the API unready (fail-open).

- [ ] **Step 1: Failing tests:**
  - `log capture for a send, a provider failure, a webhook and a verification contains no phone number, code, token or app secret`
  - `LOG_REDACT_PATHS covers to, phone, msisdn, wa_id, code, accessToken, appSecret`
  - `metric labels are bounded (no tenant, user, number)`
  - `over-limit sends are deferred, not failed, and keep order`
  - `readiness stays ready when messaging is down and reports it in the detail`
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): messaging metrics, log redaction, per-tenant send limits and readiness detail`

---

## Part B: Web

### Task 17: Platform console page

**Files:** Create `features/platform/components/messaging-*.tsx` (+ skeleton), route with `loading.tsx`, `app/actions/platform-messaging.ts`. Test: component tests, `e2e/whatsapp.spec.ts` (platform part), `e2e/skeletons.spec.ts`.

Provider credentials form (write-only fields, a "configured" chip with last4, rotate), global template list with status chips (approved, pending, rejected, paused) and a Sync button, kill switch, test send, health (breaker state, last callback). Empty state "Not configured" linking to the owner checklist. OpsDesk tokens, borderless.

- [ ] **Step 1: Failing tests:** `credential inputs never render a stored value`, `the kill switch asks for confirmation and renders its state in light and dark`, `a rejected template shows its reason chip and the banner`, `the skeleton matches the measured layout`, `a non-platform user is redirected`.
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(web): platform console WhatsApp provider and template page`

### Task 18: Settings → Integrations WhatsApp card

**Files:** Modify `features/settings/components/integrations/*` (WhatsApp card beside Google Drive, same layout and tokens), its skeleton, `app/actions/messaging.ts`; add the Hugeicons WhatsApp/chat icon to the central `Icon` map. Test: settings component tests, `e2e/whatsapp.spec.ts`.

States (model P): `Not available` (provider not configured or not in plan: disabled with a short reason and an upgrade link), `Off` ("Turn on"), `On` (status dot, "n people verified", last event time, usage bar `used / cap`, **Send test**, **Manage**, **Turn off**), `Degraded` (breaker open or templates not approved: amber chip with the reason). The header count becomes "n of 2 connected". Model T would add a Connect flow in the same card; the layout reserves the slot.

- [ ] **Step 1: Failing tests:** `the card renders the four states from the status fixture`, `Send test is disabled with a tooltip until the admin has a verified number`, `turning off asks for confirmation and says user consents are kept`, `the header counts 2 integrations`, `keyboard focus order works and hover is text-colour only on rows`, `light and dark snapshots for each state`, `the card skeleton is pixel-matched with Sk`.
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(web): WhatsApp card in Settings integrations`

### Task 19: Account → Notifications: number, verification, per-kind channels

**Files:** Modify `features/account/components/notifications-*.tsx` (+ skeleton), `app/actions/messaging.ts`. Test: component tests and `e2e/whatsapp.spec.ts`.

A WhatsApp block: country-code selector and number input (E.164 built client-side), the versioned consent text from the API with an unchecked checkbox, "Send code", a 6-box code input with resend countdown and remaining-attempt messaging, a verified state with last4 and Pause/Remove, a one-line STOP explanation. A WhatsApp column of toggles in the existing per-kind matrix (disabled with a reason chip when unverified, admin-locked, or the kind has no template). Compact, icon-first copy.

- [ ] **Step 1: Failing tests:** `Send code is disabled until the consent box is ticked`, `a wrong code shows remaining attempts and nothing more`, `429 shows a retry countdown`, `toggles are read-only with a reason when admin-locked`, `removing the number asks for confirmation and clears the column`, `only last4 is shown after verification`, `states checked in light and dark`.
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(web): per-user WhatsApp number, verification and channel toggles`

### Task 20: Admin view: defaults, template preview and delivery log

**Files:** Create `features/settings/components/messaging-*.tsx` (+ skeleton, `loading.tsx`), route `app/(app)/settings/integrations/whatsapp`. Test: component tests and e2e.

Tabs: Defaults (per-kind tenant default and admin switch, dedupe choice, burst threshold), Templates (read-only list with status and a preview of the exact generic text each kind sends), Delivery log (status chips queued/sent/delivered/read/failed/skipped, kind, user display name, last4, time, safe error code, one retry for failed rows). Empty and error states per tab.

- [ ] **Step 1: Failing tests:** `the preview never contains a title or name placeholder`, `delivery log filters and cursor paging work`, `retry is offered once for failed rows and hidden after`, `a read-only role sees disabled controls with a reason`, `skeletons match`.
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(web): WhatsApp admin defaults, template preview and delivery log`

---

## Part C: Docs, rollout, security, gate

### Task 21: Docs, privacy text and runbook

**Files:** Create `.claude/docs/deploy/runbook-whatsapp.md` (enable/disable, rotate token, template rejected, quality rating dropped, number banned, breaker stuck open, webhook not arriving, quota exceeded, Meta outage, erasure request, kill switch); modify `.claude/docs/features/settings.md`, `.claude/docs/deploy/runbook-go-live.md` (owner checklist link). No code.

- [ ] **Step 1:** Draft consent text v1 (what is sent, to which number, by whom, which kinds, how often, STOP, how to withdraw, Meta as processor, that content is generic), a privacy-notice addition, the subprocessor row (Meta Platforms Ireland Ltd and Meta Platforms Inc.), a short DPIA (data: number, template id, delivery status; purpose; retention 90 days; transfer basis) and a data-residency note (Cloud API processing location, an owner step).
- [ ] **Step 2:** Mark every text "DRAFT, pending the owner's legal advisor"; nothing ships to real users before approval.
- [ ] **Step 3: Commit** `docs: WhatsApp runbook, consent text draft, privacy and subprocessor additions`

### Task 22: Staged rollout controls and demo seed

**Files:** Modify `api/src/seed/demo/*` (a fake-provider verified demo user and a few delivered/read/failed deliveries so the card and log look alive on the demo deployment), env docs. Test: seed tests.

- [ ] **Step 1: Failing tests:** `the demo seed with MESSAGING_PROVIDER=fake creates a verified fake number and sample deliveries for one tenant only`, `the seed only uses numbers from a reserved fictional range`, `a production seed creates no messaging rows`, `enabling per tenant needs the platform flag and the entitlement and writes an audit row`.
- [ ] **Step 2 to 4.** **Step 5: Commit** `feat(api): demo seed and staged per-tenant rollout for WhatsApp`

### Task 23: Security review, pen-test pack and provider contract tests

**Files:** Modify the B7 security checklist doc under `.claude/docs/deploy/`; create `api/src/core/messaging/provider-contract.test.ts`; extend `api/test/isolation.test.ts`.

- [ ] **Step 1: Failing tests:**
  - `contract: the fake and the Meta-stub adapters pass one suite (send, status, opt-out, idempotency, error mapping); a future Twilio adapter must pass it unchanged`
  - `isolation walker: every new route classified, every param route has a tenant-B fixture, every new table in HASHED_TABLES, the webhook class tested`
  - `pen-test pack: forged signature, replayed event, oversize body, wrong content-type, number-enumeration timing, code brute force, a number belonging to another tenant's user, cross-tenant delivery-log id, stored XSS in a display name shown in the log`
  - `secrets sweep: no source, doc or OpenAPI example contains a token-shaped string`
  - `a number change after verification requires re-verification and sends a security notice by in-app and email (not WhatsApp) to the user`
  - `the public webhook has a body-size cap and a global rate limit`
- [ ] **Step 2 to 4.** **Step 5: Commit** `test(api): messaging provider contract, isolation and security pack`

### Task 24: Gate and acceptance

**Files:** `e2e/whatsapp.spec.ts` complete, `scripts/smoke/` entry, docs consolidation.

- [ ] **Step 1:** run every gate command in Global Constraints plus the e2e spec with the fake provider. **Step 2:** walk the acceptance criteria with the fake provider and record the result in the commit. **Step 3:** list the owner checklist status in the final note. **Step 4: Commit** `chore: WhatsApp integration gate (fake provider), owner checklist status`

---

## Acceptance criteria

1. A tenant admin with the entitlement can turn WhatsApp on from Settings → Integrations; with the fake provider a test message to their own verified number appears in the delivery log as sent, delivered, read.
2. A user can add a number, accept the consent text, verify with a code, choose kinds, pause or remove; every step has a consent event and an audit row; no number or code in any log.
3. A task, report or roster notification reaches WhatsApp only for users who were notified in-app, enabled the kind, verified and opted in, outside quiet hours (or held until they end), and the message carries only a generic label and a link.
4. Provider down, template not approved, quota exceeded, breaker open: in-app/email/push are unaffected and WhatsApp deliveries show a clear safe reason.
5. A STOP reply opts the user out everywhere that number is verified and stops all further sends.
6. Export and erasure cover the data; retention purges old deliveries.
7. Isolation walker, RLS-as-app_owner tests and the contract suite are green; baselines held or raised; no live provider call anywhere in CI.

## Owner checklist (manual, outside the code; nothing is done without the owner's explicit approval)

| # | Step | Who | Needed before |
|---|---|---|---|
| 1 | Answer the open decisions (provider, account model, budget, languages, first kinds) | Owner | Task 1 |
| 2 | Create and verify a Meta Business portfolio (Business Verification with company documents) | Owner (company admin) | Real sandbox send |
| 3 | Create the WhatsApp Business Account, add and verify the sender number (a number not already in the WhatsApp app), get the display name approved, choose the data region | Owner | Real sandbox send |
| 4 | Create a Meta app and a system user with a permanent token (`whatsapp_business_messaging`, `whatsapp_business_management`); note app secret, phone-number id, WABA id; hand them over only through the platform console, never chat or email | Owner | Task 5 validation |
| 5 | Set the webhook URL and verify token in the Meta app and subscribe to message status events | Owner with engineer | Task 12 validation |
| 6 | Submit the template set from the registry (texts from `templates.ts`), wait for approval, report rejections | Owner (engineer drafts, owner submits) | Task 8 validation |
| 7 | Legal: approve consent text, privacy notice, DPA/subprocessor update, DPIA, transfer basis | Owner's legal advisor | Before any real user is asked to opt in |
| 8 | Enter credentials in the platform console, run the console test message, then enable one pilot tenant | Owner | Pilot |
| 9 | Review Meta quality rating and cost weekly during the pilot | Owner | Pilot |

## Dependencies on other phases

- **Runs after B8 to B11**: B8 (roster published/changed, leave, qualification-expiry kinds, location scope), B9 (attendance kinds if they notify), B10 (payroll notices if any), B11 (incident/cover, orders, documents), so `KINDS` and recipient rules are final. Task 1 freezes the mapping; a kind added later needs a registry decision, enforced by the Task 8 test.
- Uses B7 pieces: shared rate limiter, TOTP attempt-cap helper, logger redaction list, secrets checklist, Dokploy env docs (add `MESSAGING_PROVIDER` and related env names to the deploy docs; the secrets themselves live sealed in the console, not in env).
- Billing: plan data and the platform plan editor (FR-M0-20) carry the flag and cap; no Stripe change.
- Independent of Module 2 and of the removed WhatsApp inbox.

## Effort

24 tasks: 16 API (2 to 16 plus 1 docs pre-flight), 4 web (17 to 20), 4 docs/rollout/security/gate (21 to 24). API tasks 2 to 12 are the risk core (about 60% of the work), web about 25%, docs/legal/ops about 15%. The Meta onboarding and the legal text are calendar-time dependencies the owner controls, not engineering time: start them early.

## Open decisions for the owner (default used if there is no reply)

1. **Provider/BSP.** Default: WhatsApp Business Cloud API direct from Meta, no BSP, behind `MessagingProvider` so Twilio or another BSP can be added later with no schema change. Reason: cheapest and no extra vendor in the data chain; a BSP only helps with one invoice or local support.
2. **Whose WhatsApp number/account.** Default: one platform-owned WABA and number (model P) with a per-tenant on/off; model T (each tenant brings its own account) deferred but designed for. Reason: one verification and one template set; tenants need no Meta knowledge. Flag: the sender is the platform's name, not each client's brand.
3. **Kinds that go to WhatsApp first.** Default pilot set: `task` (assigned, overdue), `report` (due, returned), `roster` (published, changed, leave decided), `security` (as an extra channel). `billing` and `invite` stay email-only for now. Everything is off per user until they opt in.
4. **Budget per message and who pays.** Default: the platform pays Meta's utility-template fees; a monthly per-tenant cap per plan (Business: 1,000 messages a month, Starter: not included); overage is skipped, not billed; revisit pass-through after the pilot cost data. The owner must confirm a per-message budget ceiling (Meta pricing varies by country and changes: check the current rate card before launch).
5. **Languages.** DECIDED by the owner (2026-11-18): English only. This is an Ireland client's project; the product has no other language, so no `bn` (or any other) template slots, no language selector, no per-user language field.
6. **Consent text and privacy wording approval.** Default: engineers ship a DRAFT in Task 21; **nothing is shown to real users until the owner's legal advisor approves it** (plus DPA/subprocessor and DPIA updates). This cannot proceed on a default for real users; fake-provider work can.
7. **Quiet hours and digest.** Default: reuse each user's quiet window; digest threshold 3 messages in 10 minutes; `security` ignores both.
8. **Cross-channel dedupe.** Default `prefer_whatsapp` for task/report/roster (email skipped once WhatsApp is delivered); never for billing and security.
9. **Plan gating.** Default: the entitlement is on for the top plan only; the owner may include it in all paid plans.
10. **Retention.** Default: delivery rows 90 days; consent events kept as legal proof for the life of the account plus the period the legal advisor sets.
11. **Pilot.** Default: the first client only, after owner checklist items 1 to 8, one week of pilot before opening to other tenants.

If there is no reply, work proceeds on these defaults for everything except item 6 (real-user exposure) and checklist items 2 to 6 (Meta onboarding), which only the owner can do.

## Owner amendments (2026-11-18, after the first draft)

- **W-18 Owner-entered number, person-confirmed.** The tenant owner enters the user's WhatsApp number when creating/inviting a user (optional field in the create/invite dialog and the user edit form, E.164, country selector, Ireland +353 default). The number is only STAGED (`pending_confirmation`): no message is sent to it until the person ticks the opt-in and verifies the one-time code in Account → Notifications (Meta requires opt-in evidence from the person, and the consent record must be the person's own). The owner can edit or clear a staged number; changing a verified number resets it to pending confirmation; every change is audited. Rationale: the employer supplies the contact, the employee consents.
- **W-19 Delivery mode is fully the tenant owner's choice.** Per notification kind and as a tenant default the owner picks one of: email only, WhatsApp only, email + WhatsApp (both always on; no forced dedupe), WhatsApp first then email if not delivered. 'Both' is always allowed. The only limit is the price plan: whether WhatsApp is available at all and the monthly WhatsApp message cap (usage shown to the owner). The per-user override can only switch a kind off, never enable a channel the owner switched off. This replaces the earlier default of `prefer_whatsapp` dedupe (open decision 8): the default for a tenant that enables WhatsApp becomes 'email + WhatsApp' for task/report/roster kinds and 'email only' for billing, and the owner may change any of it.
- **W-20 n8n (or any automation tool) is NOT embedded in the core path.** The native channel (outbox, ledger, retries, provider interface, webhooks) already does what an automation tool would do for sending. Reasons: n8n's Sustainable Use license restricts running it as part of a service offered to customers (an embed licence would be needed), it adds a multi-tenant isolation risk (credentials and workflows per tenant), an extra GDPR processor, another thing to operate and a second place where delivery can fail without our ledger knowing. Recommended instead: the existing outgoing webhooks and API keys (Settings → Integrations) let a tenant or the platform operator connect n8n/Make/Zapier OUTSIDE the product for custom automations; optionally the platform operator may run its own n8n for internal, non-critical platform automations (e.g. template-approval alerts), with no tenant data. Decision to revisit only if the owner needs tenant-defined multi-step automations: then build a small native 'rules' feature first.
