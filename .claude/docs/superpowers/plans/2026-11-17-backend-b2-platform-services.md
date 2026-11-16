# Backend B2: Platform Services (M0 rest) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared platform services every later module plugs into: domain-event bus, notifications (in-app, email, push) with quiet hours, malware-scanned tenant file storage, tenant settings + encrypted integrations (Google first), permission-aware global search, and GDPR data-subject requests.

**Architecture:** Same `api/` modular monolith. Events are written to a tenant-scoped outbox in the caller's transaction and relayed by a BullMQ worker (`api/src/worker.ts`) to in-process subscribers with per-subscriber idempotency. External systems sit behind small adapter interfaces in `Deps` (`Storage`, `MalwareScanner`, `PushSender`, `OAuthClient`, `Queue`) with fakes in tests, so the suite needs only Postgres, Redis and MinIO containers. Every new tenant table follows the R8 RLS template and gets isolation-walker coverage.

**Tech Stack:** existing (Hono/OpenAPIHono, Zod 4, Drizzle, Postgres 16, Better Auth, Vitest + Testcontainers) plus `bullmq` + Redis 7, `@aws-sdk/client-s3` + `@aws-sdk/s3-presigned-post` + `@aws-sdk/s3-request-presigner` (MinIO in dev/test), a clamd TCP client (own ~60-line INSTREAM implementation), Google OAuth via plain `fetch` (no SDK).

**Spec:** `.claude/docs/requirements/SRS.md` §4 (FR-M0-11, 12, 16, 18, 19, 20, 21), §14 NFRs; roadmap `.claude/docs/superpowers/plans/2026-11-16-hono-backend-roadmap.md` (B2); B0+B1 record `.claude/docs/superpowers/plans/2026-11-16-backend-b0-b1-foundation.md` and its rulings/follow-ups `2026-11-16-backend-b0-b1-followups.md`.

## Global Constraints

- Cross-tenant id → **404**, never 403 (AC-M0-01). Missing permission/module → **403** problem+json.
- Errors are `application/problem+json` `{ type, title, status, code, requestId }`; validation of semantic input → **422**; never a stack trace.
- Every tenant table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid` for USING and WITH CHECK (R8). Composite FKs `(tenant_id, …)` for cross-table references inside a tenant.
- Every `/v1` JSON body declares `.openapi({ example })` (R5); every new path-param route gets a `SPECS` entry in `api/test/isolation.test.ts` with the resource-specific 404 code (same actor + body for control and B-walk).
- Every state change that the spec calls auditable is recorded with `recordAudit(tx, tenantId, …, deps.clock.now())` in the **same transaction** (AC-M0-04).
- Mutations re-check the actor inside the tx with `lockActor(tx, tenantId, userId, module, need)`; module locks use the two-key namespaced form `pg_advisory_xact_lock(<NS int4>, hashtext(tenant_id::text))`, taken **first**; the audit lock stays last.
- Time comes from `deps.clock`; tenant-local times use the tenant's `timezone` (default `Europe/Dublin`), never the server's.
- Never hard-code tenant values. Never log secrets, tokens, file contents or OAuth codes.
- Secrets at rest: AES-256-GCM via `secret-box` **v2** with AAD = purpose string and a key id (T2.0).
- Signed links expire in **≤ 300 s** (FR-M0-12 "short-lived"); download links **60 s**.
- Assert pg errors via `.cause.code` (R9). `npm -w api test`, `npm -w api run typecheck`, `npx eslint api`, root `npm test`, `npm run typecheck` green after every task.

## Review Focus

1. **Event delivered twice or lost on crash** — the relay crashes after a subscriber ran but before marking delivery. Expected: subscriber effects happen exactly once per (event, subscriber). Test: T2.1 `subscriber runs once when the same event is relayed twice`.
2. **Quiet hours across midnight and DST** — quiet 22:00–07:00 Europe/Dublin on the last Sunday of October. Expected: email/push held until 07:00 local, in-app immediate. Test: T2.2 `quiet hours span midnight across the DST change`.
3. **Download of an unscanned or infected file** — a client asks for a download link right after upload, before the scan finishes, or the scan finds EICAR. Expected: 409 `file_not_ready` / 410 `file_infected`, never a link. Test: T2.3 `no download link before clean scan`.
4. **Search leaking a module the user cannot read** — a staff user searches for a team name that only `settings:read` may list. Expected: no hit, no count. Test: T2.5 `search hides modules the role cannot read`.
5. **GDPR delete leaving the person in audit/derived data** — erase a member who appears in team lists, notifications and the search index. Expected: personal fields anonymised, audit chain still verifies, search index purged. Test: T2.6 `erase anonymises and keeps the audit chain valid`.

---

## File structure

```
api/src/
  worker.ts                         # BullMQ workers entry: event relay, notification sender, scan, DSR jobs
  core/
    crypto/secret-box.ts            # (modify) v2 format with AAD + key id; v1 still opens
    queue/{queue.ts,fake-queue.ts}  # Queue adapter over BullMQ; synchronous fake for tests
    storage/{storage.ts,s3-storage.ts}
    scan/{scanner.ts,clamd-scanner.ts,fake-scanner.ts}
    push/{push.ts,fake-push.ts}
    events/{bus.ts,types.ts,relay.ts}
  db/schema/{events,notifications,files,settings,integrations,search,gdpr}.ts
  modules/
    notifications/{routes,service,preferences,quiet-hours,index}.ts
    files/{routes,service,index}.ts
    settings/{routes,service,index}.ts
    integrations/{routes,service,google,index}.ts
    search/{routes,service,indexer,index}.ts
    gdpr/{routes,service,registry,index}.ts
api/test/
  rls-guard.test.ts                 # (new) structural RLS guard (T2.0)
  containers.ts                     # (modify global-setup) redis:7 + minio
```

## Interfaces locked by this plan

```ts
// core/crypto/secret-box.ts (v2)
seal(plaintext: string, keyring: Keyring, aad: string): string        // "v2:<kid>:<iv>:<tag>:<ct>"
open(sealed: string, keyring: Keyring, aad: string): string           // also opens "v1:" (no AAD) for migration
type Keyring = { current: { id: string; key: Buffer }; previous?: { id: string; key: Buffer }[] }

// core/events
type DomainEvent = { id: string; tenantId: string; type: EventType; payload: Record<string, unknown>; occurredAt: Date; actorId: string | null }
type EventType = "member.joined" | "member.role_changed" | "invite.created" | "file.uploaded" | "file.scanned"
               | "dsr.requested" | "dsr.completed" | "integration.connected" | "integration.disconnected"
publish(tx: TenantTx, e: Omit<DomainEvent, "id" | "occurredAt">, now: Date): Promise<string>   // returns event id
subscribe(type: EventType | "*", name: string, handler: (e: DomainEvent, deps: Deps) => Promise<void>): void
relayOnce(deps: Deps, batch?: number): Promise<number>     // used by worker and tests

// Deps additions (api/src/deps.ts)
queue: Queue            // { add(name: string, data: unknown, opts?: { delayMs?: number; jobId?: string }): Promise<void> }
storage: Storage        // presignPut, presignGet, head, delete
scanner: MalwareScanner // scan(stream: Readable): Promise<{ clean: true } | { clean: false; signature: string }>
push: PushSender        // send(token: string, msg: { title: string; body: string; data?: Record<string,string> }): Promise<void>
oauth: OAuthClient      // google: { authUrl(state, codeChallenge, redirectUri), exchange(code, verifier, redirectUri), refresh(refreshToken) }

// modules/notifications
notify(tx: TenantTx, tenantId: string, input: { userId: string; kind: NotificationKind; title: string; body: string; link?: string }, deps: Deps): Promise<void>
type NotificationKind = "invite" | "member" | "file" | "security" | "dsr" | "system"

// modules/search
indexDocument(tx: TenantTx, doc: { tenantId: string; entity: string; entityId: string; module: Module; title: string; body: string }): Promise<void>
removeDocument(tx: TenantTx, tenantId: string, entity: string, entityId: string): Promise<void>

// modules/gdpr
registerDsrHandler(module: string, h: { export(tx, tenantId, userId): Promise<Record<string, unknown>>; erase(tx, tenantId, userId, now): Promise<void> }): void
```

---

### Task T2.0: Hardening carried from B0+B1 (prerequisite for new tables)

**Files:** Create `api/test/rls-guard.test.ts`; modify `api/src/core/crypto/secret-box.ts` (+ test), `api/src/env.ts` (`SECRETS_KEYS` optional JSON `{ "<kid>": "<base64>" }` with `SECRETS_KEY_ID`; `SECRETS_KEY` stays as the single-key form, kid `"k1"`), `api/src/modules/platform-email/service.ts` (seal with AAD `"platform.email.api_key"`, re-seal v1 on read), `packages/domain/src/csv.ts` (`csvSafe` also guards leading `\t` and `\r`), `api/src/modules/auth/routes.ts` (comment the R27 list), MFA_PROTECTED_AUTH_PATHS unchanged.

**Interfaces:** Produces secret-box v2 + `Keyring`, `buildKeyring(env)`.

- [ ] **Step 1: Failing tests**

```ts
test("every table with tenant_id (relkind r or p) has RLS enabled+forced AND a tenant_isolation policy using app.tenant_id", async () => {
  const bad = await ownerQuery(`
    SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='tenant_id'
    WHERE c.relkind IN ('r','p') AND c.relnamespace='public'::regnamespace
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR NOT EXISTS (
        SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_isolation'
          AND pg_get_expr(p.polqual,p.polrelid) LIKE '%app.tenant_id%'
          AND pg_get_expr(p.polwithcheck,p.polrelid) LIKE '%app.tenant_id%'))`)
  expect(bad).toEqual([])
})
test("no permissive policy other than tenant_isolation and the two documented own-row policies", async () => { /* allow-list: memberships_own_rows, roles_own_rows */ })
test("secret-box v2 binds AAD: opening with a different purpose throws", () => {
  const s = seal("re_x", ring, "platform.email.api_key")
  expect(() => open(s, ring, "integration:t:google")).toThrow()
})
test("secret-box opens v1 ciphertexts and a rotated keyring opens old-kid v2", () => {})
test("csvSafe prefixes cells starting with tab or carriage return", () => {
  expect(csvSafe("\t=1")).toBe("'\t=1"); expect(csvSafe("\r=1")).toBe("'\r=1")
})
```

- [ ] **Step 2: Run** `npm -w api test -- rls-guard secret-box` and `npx vitest run packages/domain/src/csv` → FAIL.
- [ ] **Step 3: Implement.** v2 format `v2:<kid>:<iv b64>:<tag b64>:<ct b64>`, `setAAD(Buffer.from(aad))`, IV 12 / tag 16 enforced as today. `getEmailSettings`/mailer lazily re-seal a v1 value to v2 on first successful open (one UPDATE, no audit).
- [ ] **Step 4: Run** → PASS; full api + root suites green.
- [ ] **Step 5: Commit** `chore(api): structural RLS guard, secret-box v2 with AAD and key ids`

### Task T2.1: Domain-event bus (outbox + relay)

**Files:** Create `api/src/core/events/{types,bus,relay}.ts`, `api/src/core/queue/{queue,fake-queue}.ts`, `api/src/db/schema/events.ts` + migration (`domain_events(id uuid pk, tenant_id, type, payload jsonb, actor_id, occurred_at, relayed_at null)` RLS; `event_deliveries(tenant_id, event_id, subscriber, delivered_at, pk(event_id, subscriber))` RLS), `api/src/worker.ts`; modify `api/test/global-setup.ts` (redis:7 container, `REDIS_URL`), `deps.ts`, `server.ts`.

**Interfaces:** Produces `publish`, `subscribe`, `relayOnce`, `Queue`, `DomainEvent`, `EventType`. `recordAudit` call sites that represent business events (invites, member join/role change) additionally `publish` in the same tx.

- [ ] **Step 1: Failing tests** (`api/src/core/events/bus.test.ts`)

```ts
test("publish inside a rolled-back tx leaves no event", async () => {})
test("relayOnce delivers a published event to every matching subscriber and marks relayed_at", async () => {
  subscribe("member.joined", "spy", spy)
  await withTenant(db, A, (tx) => publish(tx, { tenantId: A, type: "member.joined", payload: { userId: u }, actorId: u }, now))
  expect(await relayOnce(deps)).toBe(1)
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ type: "member.joined", tenantId: A }), expect.anything())
})
test("subscriber runs once when the same event is relayed twice", async () => {})   // Review Focus #1
test("a failing subscriber does not block others and is retried on the next relay", async () => {})
test("two concurrent relays never deliver the same event to the same subscriber twice", async () => {})  // FOR UPDATE SKIP LOCKED
test("invite creation publishes invite.created in the same transaction", async () => {})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Relay: select up to `batch` (default 100) rows `WHERE relayed_at IS NULL ORDER BY occurred_at FOR UPDATE SKIP LOCKED` as **owner-free app_user per tenant** — read pending tenant ids from a non-RLS `event_queue_hint(tenant_id)` touched by `publish`, then `withTenant` per tenant. For each subscriber: `INSERT … ON CONFLICT DO NOTHING` into `event_deliveries` **in the same tx as the handler's effects** (handler receives the tx when it writes DB state); mark `relayed_at` when all subscribers delivered. Worker runs `relayOnce` every 1 s via a BullMQ repeatable job; tests call `relayOnce` directly with `FakeQueue`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): transactional outbox event bus with idempotent relay`

### Task T2.2: Notifications (in-app, email, push) with preferences and quiet hours

**Files:** Create `api/src/modules/notifications/*`, `api/src/core/push/{push,fake-push}.ts`, schema + migration: `notifications(id, tenant_id, user_id, kind, title, body, link, created_at, read_at)`, `notification_preferences(tenant_id, user_id, channels jsonb, quiet_start time null, quiet_end time null, pk(tenant_id,user_id))`, `push_tokens(tenant_id, user_id, token_hash, token_ciphertext, platform 'android', created_at)`, `notification_deliveries(id, tenant_id, notification_id, channel, status 'sent'|'held'|'failed', send_after, attempts, last_error)`; all RLS.

**Interfaces:** Consumes `subscribe`, `deps.mailer`, `deps.push`, `deps.queue`. Produces `notify(...)`; routes `GET /v1/notifications?unread=`, `POST /v1/notifications/{id}/read`, `POST /v1/notifications/read-all`, `GET/PUT /v1/me/notification-preferences`, `POST /v1/me/push-tokens`, `DELETE /v1/me/push-tokens/{id}`. Default preferences: in-app on for all kinds; email on for `invite|security|dsr`, off otherwise; push on for all when a token exists; no quiet hours.

- [ ] **Step 1: Failing tests**

```ts
test("notify creates an in-app row and queues email per preference", async () => {})
test("a user only lists and marks their own notifications; another member's id is 404", async () => {})
test("security notifications ignore quiet hours for in-app and email", async () => {})
test("quiet hours hold email and push until the window ends in tenant time", async () => {
  // tenant tz Europe/Dublin, quiet 22:00–07:00, clock 23:30 local → delivery status held, send_after = 07:00 local
})
test("quiet hours span midnight across the DST change", async () => {})          // Review Focus #2
test("failed email delivery is retried with backoff up to 5 attempts then marked failed (logged, no body in log)", async () => {})
test("push token stored encrypted with AAD push_token:<tenant>:<user>; raw token never returned", async () => {})
test("PUT preferences validates quiet hours (HH:MM, start != end) → 422 otherwise", async () => {})
test("member.joined event notifies the tenant's owners", async () => {})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `quietWindow(prefs, tz, now): { quiet: boolean; endsAt: Date }` as a pure function in `quiet-hours.ts` (uses `Intl`/`date-fns-tz`-free arithmetic via `Temporal`-like helper you write against `Intl.DateTimeFormat` offsets; document). Senders run as queue jobs (`notification.send`), held deliveries are enqueued with `delayMs`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): notifications with channels, preferences and quiet hours`

### Task T2.3: Files — tenant-scoped storage, malware scan, signed links

**Files:** Create `api/src/core/storage/*`, `api/src/core/scan/*`, `api/src/modules/files/*`, schema + migration `files(id, tenant_id, owner_user_id, key, name, mime, size_bytes, sha256 null, status 'pending'|'clean'|'infected'|'deleted', signature null, created_at, scanned_at)` RLS; modify `global-setup.ts` (minio container), `docker-compose.dev.yml` unchanged (already has minio/clamav).

**Interfaces:** Produces routes `POST /v1/files/uploads { name, mime, sizeBytes }` → `{ fileId, upload: { url, fields } }` (presigned POST, 300 s, `content-length-range 1..sizeBytes`, exact `Content-Type`), `POST /v1/files/{id}/complete` (HEAD the object, check size/mime, status stays pending, enqueue `file.scan`), `GET /v1/files/{id}` (metadata), `GET /v1/files/{id}/download` → 302 to presigned GET (60 s) only when `clean`, `DELETE /v1/files/{id}` (soft delete + object delete job). Key layout `t/<tenantId>/<fileId>` — never derived from client names. Limits from tenant plan later (B3); for now env `FILE_MAX_BYTES` default 25 MB. Events `file.uploaded`, `file.scanned`. Requires `files` module read/write per existing `can()`.

- [ ] **Step 1: Failing tests**

```ts
test("upload intent returns a presigned POST scoped to t/<tenant>/<fileId> expiring in 300 s", async () => {})
test("complete rejects when the stored object's size or content-type differs from the intent (422 upload_mismatch)", async () => {})
test("no download link before clean scan", async () => {               // Review Focus #3
  expect((await call(app, "GET", `/v1/files/${id}/download`, a)).status).toBe(409)  // file_not_ready
})
test("EICAR upload is marked infected, object deleted, owner notified, download 410 file_infected", async () => {})
test("clean file download redirects to a presigned GET valid 60 s for the same key", async () => {})
test("client-supplied names with ../ or slashes never reach the object key", async () => {})
test("file id from another tenant → 404 file_not_found on every files route", async () => {})
test("clamd client sends INSTREAM chunks and parses 'stream: OK' / 'stream: Eicar-Signature FOUND'", async () => {})  // against an in-test TCP stub
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `ClamdScanner` (host/port from env `CLAMD_HOST`, `CLAMD_PORT`), streams the object from storage. Scan job sets `status`, `sha256`, `scanned_at` in one tx with an audit entry `file.scanned` only when infected (clean scans are not audited). Downloads audited as `file.downloaded`? — No: spec audits exports and deletions; audit `file.deleted` only.
- [ ] **Step 4: Run** → PASS; add `SPECS` entries for `/v1/files/{id}` routes.
- [ ] **Step 5: Commit** `feat(api): tenant file storage with malware scan and short-lived links`

### Task T2.4: Tenant settings, holidays, integrations framework (Google first)

**Files:** Create `api/src/modules/settings/*`, `api/src/modules/integrations/*`; schema + migrations: extend `tenants` (name, locale, timezone, currency already) via `tenant_settings` key/value (exists from T1.3) for `report_deadline` (`HH:MM`, default from onboarding-defaults `deadline`), `branding` jsonb (logo file id, primary colour); `public_holidays(tenant_id, date, name, pk(tenant_id,date))`; `integration_connections(id, tenant_id, provider 'google', status 'connected'|'revoked'|'error', scopes text[], account_email, token_ciphertext, connected_by, connected_at, last_refresh_at)` all RLS.

**Interfaces:** Routes `GET/PATCH /v1/settings/organisation`, `GET/PUT /v1/settings/branding`, `GET/PUT /v1/settings/holidays`, `GET /v1/integrations`, `POST /v1/integrations/google/start` → `{ url }`, `GET /v1/integrations/google/callback?code&state` (browser redirect back to `${APP_URL}/settings/integrations?status=…`), `DELETE /v1/integrations/{id}`. All writes `settings:write` + lockActor + audit with before/after (tokens never in audit). OAuth: PKCE S256, `state` = random 32 bytes stored hashed in `oauth_states(tenant_id, user_id, state_hash, verifier_ciphertext, expires_at)` (10 min), single use; tokens sealed with AAD `integration:<tenantId>:google`. Google endpoints via `deps.oauth` (`GoogleOAuthClient` real, `FakeOAuthClient` in tests). Drive access itself is still gated by the device policy (`requireFeatureOnDevice("drive")`) in later modules.

- [ ] **Step 1: Failing tests**

```ts
test("organisation patch validates timezone (IANA) and locale; audits before/after", async () => {})
test("report_deadline defaults from onboarding-defaults.json, not code", async () => {})
test("google start returns an auth URL with S256 challenge and a single-use state", async () => {})
test("callback with unknown, expired or reused state → 400 invalid_oauth_state, no connection", async () => {})
test("callback by a different user than the one who started → 400 invalid_oauth_state", async () => {})
test("tokens are stored sealed (v2, AAD integration:<tenant>:google) and never returned or audited", async () => {})
test("refresh failure marks the connection error and notifies the connecting admin", async () => {})
test("integration id from another tenant → 404 integration_not_found", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL; implement; run → PASS (+ SPECS entries); commit `feat(api): tenant settings, holidays and encrypted google integration`

### Task T2.5: Global search (permission- and entitlement-aware)

**Files:** Create `api/src/modules/search/*`; schema + migration `search_documents(tenant_id, entity, entity_id, module, title, body, tsv tsvector generated always as (setweight(to_tsvector('simple', title),'A') || to_tsvector('simple', body)) stored, updated_at, pk(tenant_id, entity, entity_id))` RLS + GIN index on `tsv`, trigram index on `title` (`pg_trgm`).

**Interfaces:** Produces `indexDocument`, `removeDocument`, route `GET /v1/search?q=&limit=` → `{ hits: { entity, entityId, title, module }[] }` (max 20). Indexers subscribe to events and index **members** (module `staff`→ visible per role `can(role,"staff","read")`; fallback `settings`), **teams** (`settings`), **files** (`files`) now; tasks etc. add themselves in B4+. Filter: modules where `can(role, module, "read")`; once B3 lands also entitlement-filtered (leave a single `visibleModules(c)` helper to extend).

- [ ] **Step 1: Failing tests**

```ts
test("search finds a member by partial name (prefix and trigram)", async () => {})
test("search hides modules the role cannot read", async () => {})          // Review Focus #4
test("search never returns another tenant's documents even with identical text", async () => {})
test("q shorter than 2 chars → 422; limit capped at 20", async () => {})
test("removing a member removes their document", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL; implement; PASS; commit `feat(api): permission-aware global search`

### Task T2.6: GDPR data-subject requests (export, correction, erasure)

**Files:** Create `api/src/modules/gdpr/*`; schema + migration `data_requests(id, tenant_id, subject_user_id, kind 'export'|'correct'|'erase', status 'pending'|'running'|'completed'|'rejected'|'failed', requested_by, reason, due_at, completed_at, result_file_id null, notes)` RLS.

**Interfaces:** Consumes `registerDsrHandler`, files storage, notifications, events. Routes `POST /v1/data-requests { subjectUserId, kind, reason }` (settings:write), `GET /v1/data-requests`, `GET /v1/data-requests/{id}`, `POST /v1/data-requests/{id}/complete` (for `correct`, after manual edit), `GET /v1/me/data-export` (self-service request → creates an export request for self). Due date = created + 30 days (GDPR one month). Export job collects every registered handler's JSON into a file (status clean without scan — generated by us; mime `application/json`), notifies the requester, audits `dsr.export_completed`. Erase job: each handler anonymises; core handlers for users/memberships/notifications/push tokens/devices/search/teams; Better Auth user → email `erased+<uuid>@invalid`, name `Erased user`, sessions deleted; audit rows are **not** modified (they reference ids only; document) and the chain still verifies.

- [ ] **Step 1: Failing tests**

```ts
test("export bundles every registered handler and is downloadable only by the requester and settings:write", async () => {})
test("erase anonymises and keeps the audit chain valid", async () => {     // Review Focus #5
  expect(await verifyChain(db, A)).toMatchObject({ ok: true })
  expect(await searchFor(A, "Mary Byrne")).toEqual([])
})
test("erase of the last owner is rejected 409 last_owner", async () => {})
test("subject from another tenant → 404 member_not_found", async () => {})
test("due_at = requested_at + 30 days in tenant time; overdue requests listed first", async () => {})
test("every request and completion is audited; reasons stored, not logged", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL; implement; PASS (+ SPECS); commit `feat(api): gdpr data-subject export, correction and erasure`

---

## Done criteria for B2

- FR-M0-11, 12, 16, 18, 19, 20 (tenant locale/timezone/currency settings), 21 have passing tests; isolation walker covers every new path-param route.
- `api/src/worker.ts` runs the relay, notification, scan and DSR jobs against real Redis; `api/Dockerfile` builds and the image starts both `server` and `worker` commands.
- Follow-ups closed here: structural RLS guard, secret-box AAD/key id, csvSafe tab/CR.
