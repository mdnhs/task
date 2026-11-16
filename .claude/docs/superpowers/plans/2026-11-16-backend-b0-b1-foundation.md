# Backend B0 + B1: Foundation, Identity and Access — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Hono API package with a tenant-isolated Postgres, then deliver M0's identity core: sign-in, tenants and invites, audit, RBAC, forced MFA, teams, device policy, and the cross-tenant isolation walker.

**Architecture:** `api/` is an npm workspace running Hono on Node. `createApp(deps)` builds the app from injected dependencies (db, auth, clock, mailer) so tests run it in-process with `app.request()`. Every tenant table has `tenant_id` plus forced Postgres RLS keyed on `current_setting('app.tenant_id', true)`; `withTenant()` sets it with `set_config(..., true)` inside a transaction. Better Auth owns identity only (user, session, account, two-factor); the API owns tenants, memberships, roles and policies. The active tenant comes from the `X-Tenant` header (slug) and is checked against memberships on every request.

**Tech Stack:** Node 22, Hono 4, `@hono/node-server`, `@hono/zod-openapi`, Zod 4, Drizzle ORM + drizzle-kit, PostgreSQL 16, Better Auth (+ `twoFactor` plugin), Vitest, `@testcontainers/postgresql`, pino.

**Spec:** `.claude/docs/requirements/SRS.md` §4 (Module 0), §14 (NFRs); roadmap `.claude/docs/superpowers/plans/2026-11-16-hono-backend-roadmap.md` (phases B0, B1 and "Cross-phase interfaces").

## Global Constraints

- Cross-tenant id → **404 "not found"**, never 403 (AC-M0-01). Missing permission or module → **403**.
- Errors are `application/problem+json`: `{ type, title, status, code, requestId }`; never a stack trace in the body.
- Tenant defaults come from data, never code: timezone `Europe/Dublin`, currency `EUR`, locale `en-IE` (FR-M0-20), seeded from `public/data/auth/onboarding-defaults.json`.
- Session idle timeout per tenant, default **12** hours (NFR-04).
- Audit entries record who, what, when, old value and new value (AC-M0-04); the app DB role has no UPDATE/DELETE on `audit_events` (FR-M0-13, NFR-05).
- Device policy is evaluated on every request, not at sign-in (FR-M0-10).
- `DATA_REGION` must be `eu-west-1` or `eu-central-1` (NFR-02).
- The app connects as role `app_user` (no BYPASSRLS, not table owner); migrations run as `app_owner`.
- Every route lives under `/v1`; auth handler under `/api/auth/*`.
- Existing web tests (`npm test`) and `npm run typecheck` stay green after every task.

## Review Focus

1. **Spoofed `X-Tenant` header** — a signed-in user sends a slug of a tenant they do not belong to. Expected: 404 on every route. Test: T1.3 `x-tenant of non-member tenant is 404`.
2. **Tenant setting leaking across pooled connections** — request A sets `app.tenant_id`; the next request on the same pooled connection runs without `withTenant`. Expected: zero rows. Test: T0.3 `tenant setting does not leak to the next pooled query`.
3. **Device trust revoked mid-session** — admin untrusts a PC while its session is live. Expected: the next response withholds Drive links. Test: T1.7 `trust revoked mid-session withholds drive on next request`.
4. **TOTP clock skew** — the phone clock is 25 s behind. Expected: code from the previous 30 s step accepted, older rejected. Test: T1.5 `totp accepts one previous step, rejects two`.
5. **Last owner demoted or leaving** — the only tenant owner changes their own role. Expected: 409, tenant never ownerless. Test: T1.4 `last owner cannot be demoted`.

---

## File structure

```
package.json                         # + "workspaces": ["api", "packages/*"]; + "test:api"
next.config.ts                       # + transpilePackages: ["@opsdesk/domain"]
docker-compose.dev.yml               # postgres:16, redis:7, minio, clamav, mailpit
.github/workflows/ci.yml
packages/domain/
  package.json                       # name "@opsdesk/domain", exports "./*": "./src/*.ts"
  src/*.ts, src/*.test.ts            # moved pure modules (T0.4)
api/
  package.json, tsconfig.json, vitest.config.ts, drizzle.config.ts, Dockerfile
  src/
    env.ts                           # parseEnv()
    app.ts                           # createApp(deps), type AppType
    server.ts                        # node entry
    deps.ts                          # type Deps, makeDeps(env)
    core/
      context.ts                     # AppEnv
      errors.ts                      # AppError + subclasses, problem()
      middleware/request-id.ts
      middleware/session.ts          # requireSession
      middleware/tenant.ts           # requireTenant
      middleware/permission.ts       # requirePermission
      middleware/mfa.ts              # enforceMfa
      middleware/device.ts           # loadDevice, requireFeatureOnDevice
    db/
      client.ts                      # makeDb(url)
      tenant-tx.ts                   # withTenant
      schema/{auth,tenants,audit,rbac,teams,devices}.ts
      migrations/                    # drizzle-kit output + 0000_roles_rls.sql (hand-written)
    modules/
      auth/{auth.ts,routes.ts}
      tenants/{routes.ts,service.ts,repo.ts,schema.ts,index.ts}
      invites/{routes.ts,service.ts,index.ts}
      audit/{record.ts,verify.ts,routes.ts,index.ts}
      rbac/{routes.ts,service.ts,fields.ts,index.ts}
      mfa/{routes.ts,service.ts,index.ts}
      teams/{routes.ts,service.ts,index.ts}
      devices/{routes.ts,service.ts,index.ts}
  test/
    global-setup.ts                  # one Postgres container per run, migrate
    harness.ts                       # testApp(), resetDb()
    factories.ts                     # makeTenant(), makeMember(), signIn()
    fakes.ts                         # fakeClock(), fakeMailer()
    isolation.test.ts                # T1.8
```

## Interfaces locked by this plan

```ts
// api/src/env.ts
export type Env = { NODE_ENV: "development" | "test" | "production"; PORT: number; DATABASE_URL: string;
  DATABASE_OWNER_URL: string; REDIS_URL: string; BETTER_AUTH_SECRET: string; APP_URL: string;
  DATA_REGION: "eu-west-1" | "eu-central-1"; GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string; MICROSOFT_CLIENT_SECRET?: string }
export function parseEnv(input: Record<string, string | undefined>): Env

// api/src/deps.ts
export type Clock = { now(): Date }
export type Mailer = { send(msg: { to: string; subject: string; text: string }): Promise<void> }
export type Deps = { env: Env; db: Db; auth: Auth; clock: Clock; mailer: Mailer }

// api/src/app.ts
export function createApp(deps: Deps): OpenAPIHono<AppEnv>
export type AppType = ReturnType<typeof createApp>

// api/src/core/context.ts
export type AppEnv = { Variables: {
  deps: Deps; requestId: string
  session?: { id: string; userId: string; lastSeenAt: Date; mfaPassed: boolean }
  user?: { id: string; email: string }
  tenant?: { id: string; slug: string; timezone: string; currency: string; locale: string; sessionIdleHours: number }
  member?: { userId: string; roleId: string; roleKey: string }
  role?: Role                              // @opsdesk/domain/types
  device?: Device                          // @opsdesk/domain/devices
}}

// api/src/core/errors.ts
export class AppError extends Error { constructor(status: number, code: string, title: string) }
export const NotFound = (code = "not_found") => new AppError(404, code, "Not Found")
export const Forbidden = (code: string) => new AppError(403, code, "Forbidden")
export const Unauthorized = (code: string) => new AppError(401, code, "Unauthorized")
export const Conflict = (code: string) => new AppError(409, code, "Conflict")

// api/src/db/tenant-tx.ts
export type TenantTx = Parameters<Parameters<Db["transaction"]>[0]>[0]
export function withTenant<T>(db: Db, tenantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T>

// api/src/modules/audit
export type AuditInput = { action: string; entity: string; entityId: string; actorId: string | null;
  before: unknown; after: unknown }
export function recordAudit(tx: TenantTx, tenantId: string, e: AuditInput, now: Date): Promise<void>
export function verifyChain(db: Db, tenantId: string): Promise<{ ok: true } | { ok: false; brokenAt: string }>

// middleware
export const requireSession: MiddlewareHandler<AppEnv>
export const requireTenant: MiddlewareHandler<AppEnv>          // reads X-Tenant
export function requirePermission(module: Module, need: "read" | "write"): MiddlewareHandler<AppEnv>
export const enforceMfa: MiddlewareHandler<AppEnv>
export const loadDevice: MiddlewareHandler<AppEnv>
export function requireFeatureOnDevice(feature: DeviceFeature): MiddlewareHandler<AppEnv>

// test helpers
export function testApp(over?: Partial<Deps>): { app: AppType; deps: Deps; mailer: FakeMailer; clock: FakeClock }
export function resetDb(): Promise<void>
export function makeTenant(deps: Deps, over?: Partial<{ slug: string; sessionIdleHours: number; mfaPolicy: MfaPolicy }>): Promise<{ id: string; slug: string }>
export function makeMember(deps: Deps, tenantId: string, roleKey: string, over?: { email?: string; totp?: boolean }): Promise<{ userId: string; email: string; password: string }>
export function signIn(app: AppType, email: string, password: string): Promise<{ cookie: string }>
export function call(app: AppType, method: string, path: string, o?: { cookie?: string; tenant?: string; body?: unknown; headers?: Record<string, string> }): Promise<Response>
```

---

## B0: Workspace and API skeleton

### Task T0.1: Workspace, dev services, env

**Files:**
- Modify: `package.json` (workspaces, `"test:api": "npm -w api test"`)
- Create: `docker-compose.dev.yml`, `api/package.json`, `api/tsconfig.json`, `api/vitest.config.ts`, `api/src/env.ts`
- Test: `api/src/env.test.ts`

**Interfaces:** Produces `parseEnv`, `Env`.

- [ ] **Step 1: Write the failing tests**

```ts
const base = { DATABASE_URL: "postgres://a", DATABASE_OWNER_URL: "postgres://o", REDIS_URL: "redis://r",
  BETTER_AUTH_SECRET: "x".repeat(32), APP_URL: "http://localhost:3000", DATA_REGION: "eu-west-1" }

test("parseEnv rejects missing DATABASE_URL", () => {
  const { DATABASE_URL, ...rest } = base
  expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/)
})
test("parseEnv defaults PORT to 8787 and NODE_ENV to development", () => {
  expect(parseEnv(base)).toMatchObject({ PORT: 8787, NODE_ENV: "development" })
})
test("parseEnv rejects a non-EU DATA_REGION", () => {
  expect(() => parseEnv({ ...base, DATA_REGION: "us-east-1" })).toThrow(/DATA_REGION/)
})
test("parseEnv rejects BETTER_AUTH_SECRET shorter than 32 chars", () => {
  expect(() => parseEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/)
})
```

- [ ] **Step 2: Run** `npm -w api test -- env` → FAIL ("Cannot find module './env'").
- [ ] **Step 3: Implement `parseEnv`** with one Zod object; `PORT` via `z.coerce.number().default(8787)`. Compose file pins `postgres:16`, `redis:7`, `minio/minio`, `clamav/clamav`, `axllent/mailpit`.
- [ ] **Step 4: Run** `npm -w api test -- env` → PASS. `docker compose -f docker-compose.dev.yml up -d` → all 5 healthy.
- [ ] **Step 5: Commit** `feat(api): workspace, dev services, env parsing`

### Task T0.2: Hono app, errors, request id, health, OpenAPI

**Files:**
- Create: `api/src/app.ts`, `api/src/server.ts`, `api/src/deps.ts`, `api/src/core/{context,errors}.ts`, `api/src/core/middleware/request-id.ts`, `api/test/{harness,fakes}.ts` (no DB yet: `testApp` accepts a fake `db`)
- Test: `api/src/app.test.ts`

**Interfaces:** Consumes `Env`. Produces `createApp`, `AppType`, `AppEnv`, `AppError` family, `testApp`, `call`, `fakeClock`, `fakeMailer`.

- [ ] **Step 1: Write the failing tests**

```ts
test("GET /healthz returns 200 ok", async () => {
  const r = await call(testApp().app, "GET", "/healthz")
  expect(r.status).toBe(200); expect(await r.json()).toEqual({ status: "ok" })
})
test("unknown route returns problem+json 404", async () => {
  const r = await call(testApp().app, "GET", "/v1/nope")
  expect(r.status).toBe(404)
  expect(r.headers.get("content-type")).toMatch(/application\/problem\+json/)
  expect(await r.json()).toMatchObject({ status: 404, title: "Not Found", code: "not_found", requestId: expect.any(String) })
})
test("incoming x-request-id is echoed, missing one is generated", async () => {
  const { app } = testApp()
  expect((await call(app, "GET", "/healthz", { headers: { "x-request-id": "abc" } })).headers.get("x-request-id")).toBe("abc")
  expect((await call(app, "GET", "/healthz")).headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/)
})
test("AppError maps to its status; unknown errors become 500 without stack", async () => {
  const { app } = testApp()
  app.get("/v1/_conflict", () => { throw Conflict("dup") })
  app.get("/v1/_boom", () => { throw new Error("secret detail") })
  expect((await call(app, "GET", "/v1/_conflict")).status).toBe(409)
  const r = await call(app, "GET", "/v1/_boom")
  expect(r.status).toBe(500); expect(await r.text()).not.toContain("secret detail")
})
test("GET /readyz returns 503 when the db ping fails", async () => {
  const { app } = testApp({ db: { execute: async () => { throw new Error("down") } } as never })
  expect((await call(app, "GET", "/readyz")).status).toBe(503)
})
test("GET /v1/openapi.json serves OpenAPI 3.1 with version 1", async () => {
  const j = await (await call(testApp().app, "GET", "/v1/openapi.json")).json()
  expect(j.openapi).toMatch(/^3\.1/); expect(j.info.version).toBe("1")
})
```

- [ ] **Step 2: Run** `npm -w api test -- app` → FAIL.
- [ ] **Step 3: Implement** `createApp(deps)` with `OpenAPIHono<AppEnv>`, `app.onError` → `problem()`, `app.notFound`, request-id middleware (`crypto.randomUUID()`), pino logger with `requestId`. `server.ts` = `serve({ fetch: createApp(makeDeps(parseEnv(process.env))).fetch, port })`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): hono app with problem+json errors, health, openapi`

### Task T0.3: Drizzle, roles, RLS, `withTenant`, DB test harness

**Files:**
- Create: `api/src/db/{client,tenant-tx}.ts`, `api/src/db/schema/tenants.ts` (table `tenants` only: `id uuid pk`, `slug text unique`, `name`, `timezone`, `currency`, `locale`, `session_idle_hours int default 12`, `status`, `created_at`), `api/src/db/migrations/0000_roles_rls.sql`, `api/drizzle.config.ts`, `api/test/global-setup.ts`
- Create (test-only migration): `rls_probe(id uuid, tenant_id uuid, label text)` with the standard policy
- Test: `api/src/db/tenant-tx.test.ts`

**Interfaces:** Produces `makeDb`, `Db`, `withTenant`, `TenantTx`, `resetDb`, and the RLS SQL template every later table copies:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY; ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON <t> USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

- [ ] **Step 1: Write the failing tests**

```ts
test("RLS hides other tenant rows even without WHERE", async () => {
  await ownerInsertProbe([{ tenant: A, label: "a" }, { tenant: B, label: "b" }])
  const rows = await withTenant(db, A, (tx) => tx.select().from(rlsProbe))
  expect(rows.map((r) => r.label)).toEqual(["a"])
})
test("insert with another tenant's id is rejected", async () => {
  await expect(withTenant(db, A, (tx) => tx.insert(rlsProbe).values({ tenantId: B, label: "x" })))
    .rejects.toThrow(/row-level security/)
})
test("query outside withTenant returns zero rows", async () => {
  await ownerInsertProbe([{ tenant: A, label: "a" }])
  expect(await db.select().from(rlsProbe)).toEqual([])
})
test("tenant setting does not leak to the next pooled query", async () => {   // Review Focus #2
  await ownerInsertProbe([{ tenant: A, label: "a" }])
  await withTenant(db, A, (tx) => tx.select().from(rlsProbe))
  for (let i = 0; i < 20; i++) expect(await db.select().from(rlsProbe)).toEqual([])
})
test("every table with a tenant_id column has RLS enabled and forced", async () => {
  const bad = await ownerQuery(`SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE a.attname = 'tenant_id' AND c.relkind = 'r' AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`)
  expect(bad).toEqual([])
})
test("app_user cannot bypass RLS", async () => {
  expect(await ownerQuery(`SELECT rolbypassrls FROM pg_roles WHERE rolname = 'app_user'`)).toEqual([{ rolbypassrls: false }])
})
```

- [ ] **Step 2: Run** `npm -w api test -- tenant-tx` → FAIL.
- [ ] **Step 3: Implement** `withTenant` as `db.transaction(async (tx) => { await tx.execute(sql\`select set_config('app.tenant_id', ${id}, true)\`); return fn(tx) })`. Global setup starts `postgres:16` via Testcontainers, runs migrations as owner, exports both URLs; `resetDb()` truncates all tables as owner. Pool size in tests = 2 so the leak test reuses connections.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): postgres with forced RLS and withTenant`

### Task T0.4: Move pure rules into `@opsdesk/domain`

**Files:**
- Create: `packages/domain/package.json`, `packages/domain/tsconfig.json`, `packages/domain/src/no-io.test.ts`
- Move (with their `.test.ts`) from `lib/` to `packages/domain/src/`: `types, permissions, devices, entitlements, mfa, dates, money, csv, paginate, notify, report-deadline, roster-access, roster-overlay, roster-repeat, roster-rules, rosters, shift-report, shifts, support-access, task-evidence, task-scope, task-notices, today`
- Replace each moved `lib/<name>.ts` with `export * from "@opsdesk/domain/<name>"` (keeps every `@/lib/...` import in the web app working)
- Modify: `next.config.ts` (`transpilePackages`), root `vitest.config.ts` (include `packages/**`)
- Do **not** move: `data, session, device-session, store, *-data, org, people, workforce, request-path, utils, motion, zoom, clipboard, appearance, branding, brand, ics, count-format, task-inbox, task-voice, today-prefs, audit-outbox` (I/O, browser or UI). If a moved file imports one of these, leave that file in `lib/` and note it in the commit message.

**Interfaces:** Produces `@opsdesk/domain/<name>` with the exact exports these files have today (e.g. `can(role, module, need)`, `canUse(feature, device, policies)`, `withholdDriveLinks(tasks)`, `mfaRequired(policy, roleId)`, `resolveEntitlements(data, planId, overrides)`, `reportScope(role, meId)`).

- [ ] **Step 1: Write the failing test**

```ts
test("domain has no I/O, framework or app-alias imports", () => {
  const offenders = readdirSync(__dirname).filter((f) => f.endsWith(".ts"))
    .filter((f) => /from "(node:|next\/|react|@\/)/.test(readFileSync(join(__dirname, f), "utf8")))
  expect(offenders).toEqual([])
})
```

- [ ] **Step 2: Run** `npx vitest run packages/domain` → FAIL (package missing).
- [ ] **Step 3: Move files** with `git mv`, add shims, configure the package.
- [ ] **Step 4: Verify** `npm test` (same pass count as before the move), `npm run typecheck`, `npm run build` → all green.
- [ ] **Step 5: Commit** `refactor: move pure business rules to @opsdesk/domain`

### Task T0.5: CI

**Files:** Create `.github/workflows/ci.yml`, `api/Dockerfile`.

- [ ] **Step 1:** Jobs: `web` (typecheck, lint, `npm test`, build), `api` (typecheck, `npm -w api test` — Docker available on `ubuntu-latest` for Testcontainers), `security` (CodeQL for JS/TS, `npm audit --audit-level=high`), `image` (build `api/Dockerfile`, multi-stage, non-root user).
- [ ] **Step 2: Verify** push the branch → all four jobs green; a deliberately failing test in a throwaway commit turns `api` red (then revert).
- [ ] **Step 3: Commit** `ci: web, api, security and image jobs`

---

## B1: Identity, tenancy, access

### Task T1.1: Better Auth sign-in, session middleware, idle timeout

**Files:**
- Create: `api/src/modules/auth/{auth.ts,routes.ts}`, `api/src/db/schema/auth.ts` (Better Auth tables via its Drizzle adapter: `user`, `session`, `account`, `verification`, `two_factor`), `api/src/core/middleware/session.ts`, `api/test/factories.ts` (`makeTenant`, `makeMember`, `signIn`)
- Test: `api/src/modules/auth/auth.test.ts`

**Interfaces:**
- Produces `buildAuth(deps): Auth` (Better Auth instance, `emailAndPassword.enabled`, `twoFactor({ issuer: "OpsDesk" })`, `socialProviders` only for providers whose env vars are set), `requireSession`, `GET /v1/me → { user: { id, email }, tenants: { slug, name, roleKey }[] }`.
- Idle timeout is checked by `requireSession` (needs tenant hours), so `session.lastSeenAt` is updated on each request.

- [ ] **Step 1: Write the failing tests**

```ts
test("sign-up then sign-in returns a session cookie and /v1/me works", async () => {
  const { app } = testApp()
  await call(app, "POST", "/api/auth/sign-up/email", { body: { email: "a@x.ie", password: "Passw0rd!long", name: "A" } })
  const { cookie } = await signIn(app, "a@x.ie", "Passw0rd!long")
  const r = await call(app, "GET", "/v1/me", { cookie })
  expect(r.status).toBe(200); expect((await r.json()).user.email).toBe("a@x.ie")
})
test("GET /v1/me without a cookie is 401 unauthenticated", async () => {
  const r = await call(testApp().app, "GET", "/v1/me")
  expect(r.status).toBe(401); expect((await r.json()).code).toBe("unauthenticated")
})
test("session idle longer than the tenant's hours is 401 session_expired", async () => {
  const { app, deps, clock } = testApp()
  const t = await makeTenant(deps, { sessionIdleHours: 1 })
  const m = await makeMember(deps, t.id, "staff")
  const { cookie } = await signIn(app, m.email, m.password)
  clock.advance({ minutes: 61 })
  const r = await call(app, "GET", "/v1/me", { cookie, tenant: t.slug })
  expect(r.status).toBe(401); expect((await r.json()).code).toBe("session_expired")
})
test("activity inside the window keeps the session alive", async () => {
  // same setup; advance 50 min, call, advance 50 min, call → both 200
})
test("social providers are registered only when their env vars are set", () => {
  expect(Object.keys(buildAuth(depsWith({ GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "s" })).options.socialProviders ?? {})).toEqual(["google"])
})
```

- [ ] **Step 2: Run** `npm -w api test -- auth` → FAIL.
- [ ] **Step 3: Implement** `buildAuth`; mount `app.on(["GET","POST"], "/api/auth/*", (c) => auth.handler(c.req.raw))`; `requireSession` calls `auth.api.getSession({ headers })`, compares `lastSeenAt` with `deps.clock.now()` and the tenant's `session_idle_hours` (12 when no tenant header), then updates `lastSeenAt`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): better-auth sign-in with per-tenant idle timeout`

### Task T1.2: Audit log (hash chain, append-only, export)

**Files:**
- Create: `api/src/db/schema/audit.ts` (`audit_events`: `id uuid`, `tenant_id`, `seq bigint`, `at timestamptz`, `actor_id`, `action`, `entity`, `entity_id`, `before jsonb`, `after jsonb`, `prev_hash`, `hash`; unique `(tenant_id, seq)`), migration granting `app_user` only `SELECT, INSERT` on it, `api/src/modules/audit/{record,verify,routes,index}.ts`
- Test: `api/src/modules/audit/audit.test.ts`

**Interfaces:** Produces `recordAudit`, `verifyChain`, `GET /v1/audit?entity=&from=&to=` and `GET /v1/audit/export?format=csv` (needs `audit` read).

- [ ] **Step 1: Write the failing tests**

```ts
test("each entry hashes the previous one", async () => {
  await withTenant(db, A, async (tx) => { await recordAudit(tx, A, e1, now); await recordAudit(tx, A, e2, now) })
  const [r1, r2] = await ownerQuery(`SELECT * FROM audit_events WHERE tenant_id = $1 ORDER BY seq`, [A])
  expect(r1.prev_hash).toBe("GENESIS")
  expect(r2.prev_hash).toBe(r1.hash)
  expect(r2.hash).toBe(sha256(r1.hash + canonicalJson({ seq: 2, at: now, actorId: e2.actorId, action: e2.action, entity: e2.entity, entityId: e2.entityId, before: e2.before, after: e2.after })))
})
test("verifyChain detects a tampered row", async () => {
  // record 3 entries, then as owner: UPDATE audit_events SET after = '{"x":1}' WHERE seq = 2
  expect(await verifyChain(db, A)).toEqual({ ok: false, brokenAt: idOfSeq2 })
})
test("app_user cannot update or delete audit rows", async () => {
  await expect(withTenant(db, A, (tx) => tx.update(auditEvents).set({ action: "x" }))).rejects.toThrow(/permission denied/)
  await expect(withTenant(db, A, (tx) => tx.delete(auditEvents))).rejects.toThrow(/permission denied/)
})
test("concurrent writes in one tenant keep seq gap-free", async () => {
  await Promise.all(Array.from({ length: 10 }, (_, i) => withTenant(db, A, (tx) => recordAudit(tx, A, { ...e1, entityId: String(i) }, now))))
  expect((await ownerQuery(`SELECT seq FROM audit_events WHERE tenant_id=$1 ORDER BY seq`, [A])).map((r) => Number(r.seq))).toEqual([1,2,3,4,5,6,7,8,9,10])
  expect(await verifyChain(db, A)).toEqual({ ok: true })
})
test("export returns CSV with who, what, when, old and new value and is itself audited", async () => {
  const r = await call(app, "GET", "/v1/audit/export?format=csv", { cookie: adminCookie, tenant: t.slug })
  expect(r.status).toBe(200)
  expect((await r.text()).split("\n")[0]).toBe("at,actor,action,entity,entity_id,before,after")
  expect(await lastAudit(t.id)).toMatchObject({ action: "audit.exported" })
})
test("export without audit read is 403", async () => { /* staff cookie → 403 */ })
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `recordAudit`: `SELECT pg_advisory_xact_lock(hashtext(tenant_id))`, read last `(seq, hash)`, insert next. `canonicalJson` = keys sorted recursively. CSV via `@opsdesk/domain/csv`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): hash-chained append-only audit log with export`

### Task T1.3: Tenants, tenant middleware, invites

**Files:**
- Create: `api/src/db/schema/tenants.ts` (extend: `memberships(tenant_id, user_id, role_id, status, joined_at)`, `invites(id, tenant_id, email, role_id, token_hash, expires_at, accepted_at)`), `api/src/core/middleware/tenant.ts`, `api/src/modules/tenants/*`, `api/src/modules/invites/*`
- Test: `api/src/modules/tenants/tenants.test.ts`, `api/src/modules/invites/invites.test.ts`

**Interfaces:**
- Consumes `recordAudit`, `requireSession`. Role seeding from T1.4 is called through `seedRoleTemplates(tx, tenantId)`; until T1.4 lands, a stub creates `owner` only.
- Produces `requireTenant`, `POST /v1/tenants { name, slug, timezone?, currency?, locale? } → 201 { id, slug }`, `POST /v1/invites { email, roleId } → 201`, `POST /v1/invites/accept { token } → 200`.
- Invite lifetime: **7 days** (engineering default; stored as tenant setting `invite_ttl_days`).

- [ ] **Step 1: Write the failing tests**

```ts
test("creating a tenant makes the caller owner with data-driven defaults", async () => {
  const r = await call(app, "POST", "/v1/tenants", { cookie, body: { name: "Coppers", slug: "coppers" } })
  expect(r.status).toBe(201)
  expect(await tenantRow("coppers")).toMatchObject({ timezone: "Europe/Dublin", currency: "EUR", locale: "en-IE", sessionIdleHours: 12 })
  expect(await membershipOf(userId, "coppers")).toMatchObject({ roleKey: "owner" })
})
test("duplicate slug is 409 slug_taken", async () => { /* create twice */ })
test("x-tenant of non-member tenant is 404", async () => {            // Review Focus #1
  const r = await call(app, "GET", "/v1/me/tenant", { cookie: userOfA, tenant: tenantB.slug })
  expect(r.status).toBe(404)
})
test("missing x-tenant on a tenant route is 400 tenant_required", async () => { /* ... */ })
test("invite emails a link; accepting adds membership with the invited role", async () => {
  await call(app, "POST", "/v1/invites", { cookie: admin, tenant: t.slug, body: { email: "new@x.ie", roleId: staffRoleId } })
  const token = mailer.last().text.match(/token=([\w-]+)/)![1]
  const { cookie } = await signUpAndIn(app, "new@x.ie")
  expect((await call(app, "POST", "/v1/invites/accept", { cookie, body: { token } })).status).toBe(200)
  expect(await membershipOf(newUserId, t.slug)).toMatchObject({ roleId: staffRoleId })
})
test("invite token is stored hashed, not in plain text", async () => { /* token_hash !== token */ })
test("expired invite is 410 invite_expired", async () => { /* clock.advance({ days: 8 }) */ })
test("invite cannot be accepted by a user with another email (403 invite_email_mismatch)", async () => {})
test("invite.created and member.joined are audited", async () => {})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `requireTenant`: read `X-Tenant`, look up tenant by slug (owner-level lookup of `tenants` only), then `memberships` for `(tenant, user)`; absent either → `NotFound()`. Sets `c.var.tenant`, `c.var.member`. Defaults read once from `public/data/auth/onboarding-defaults.json` into a seed table at migration time.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): tenants, tenant context and email invites`

### Task T1.4: RBAC — templates, clone, record and field rules

**Files:**
- Create: `api/src/db/schema/rbac.ts` (`roles(id, tenant_id, key, label, description, home, access jsonb, field_rules jsonb, is_template bool, cloned_from uuid null)`), `api/src/core/middleware/permission.ts`, `api/src/modules/rbac/{routes,service,fields,index}.ts`
- Test: `api/src/modules/rbac/rbac.test.ts`

**Interfaces:**
- Consumes `can()`, `reportScope()`, `shiftScope()` from `@opsdesk/domain/permissions`; role templates from `public/data/shell/roles.json`.
- Produces `seedRoleTemplates(tx, tenantId)`, `requirePermission(module, need)`, `redactFields<T>(role: Role, entity: string, row: T): T` (`field_rules: Record<entity, string[]>` = hidden field paths), routes `GET /v1/roles`, `POST /v1/roles/:id/clone`, `PATCH /v1/roles/:id { label?, access?, fieldRules? }`, `PATCH /v1/members/:userId { roleId }`.

- [ ] **Step 1: Write the failing tests**

```ts
test("new tenant gets one template per role in shell/roles.json", async () => {
  expect((await rolesOf(t.id)).filter((r) => r.isTemplate).map((r) => r.key).sort()).toEqual(rolesJson.map((r) => r.id).sort())
})
test("requirePermission blocks write for a read-only role with 403 forbidden", async () => {
  // role with access.tasks = "read" → POST /v1/_probe/tasks (test-only route guarded by requirePermission("tasks","write")) → 403
})
test("template roles are read-only; PATCH on a template is 409 template_locked", async () => {})
test("clone copies access, records cloned_from, and edits leave the template unchanged", async () => {
  const c = await (await call(app, "POST", `/v1/roles/${managerTpl}/clone`, { cookie: admin, tenant: t.slug, body: { label: "Night lead" } })).json()
  await call(app, "PATCH", `/v1/roles/${c.id}`, { cookie: admin, tenant: t.slug, body: { access: { ...tplAccess, payroll: "none" } } })
  expect(await role(managerTpl)).toMatchObject({ access: tplAccess })
  expect(await role(c.id)).toMatchObject({ clonedFrom: managerTpl, access: { payroll: "none" } })
})
test("permission change is audited with old and new access", async () => {   // AC-M0-04
  expect(await lastAudit(t.id)).toMatchObject({ action: "role.updated", before: { access: tplAccess }, after: { access: { payroll: "none" } } })
})
test("redactFields removes hidden paths only for that role", () => {
  expect(redactFields(roleWith({ member: ["payRate"] }), "member", { name: "A", payRate: 14 })).toEqual({ name: "A" })
})
test("role id from another tenant is 404", async () => {})
test("last owner cannot be demoted (409 last_owner)", async () => {           // Review Focus #5
  const r = await call(app, "PATCH", `/v1/members/${ownerId}`, { cookie: owner, tenant: t.slug, body: { roleId: staffRoleId } })
  expect(r.status).toBe(409); expect((await r.json()).code).toBe("last_owner")
})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `requirePermission` loads the member's role (cached per request), calls `can()`, throws `Forbidden("forbidden")`. Owner count checked inside the same transaction with `SELECT ... FOR UPDATE`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): role templates, clone, field rules and permission guard`

### Task T1.5: TOTP MFA and forced MFA

**Files:**
- Create: `api/src/core/middleware/mfa.ts`, `api/src/modules/mfa/{routes,service,index}.ts`; add `mfa_policy jsonb default '{"mode":"off","roles":[]}'` to `tenants`
- Test: `api/src/modules/mfa/mfa.test.ts`

**Interfaces:**
- Consumes `mfaRequired(policy, roleId)`, `parseMfaPolicy(input, validRoles)` from `@opsdesk/domain/mfa`; Better Auth `twoFactor` endpoints (`/api/auth/two-factor/enable`, `/verify-totp`).
- Produces `enforceMfa` (mounted after `requireTenant` on all `/v1` tenant routes; allow-list `/v1/me`, `/v1/me/mfa/*`), `PUT /v1/settings/mfa-policy { mode, roles }` (needs `settings` write).

- [ ] **Step 1: Write the failing tests**

```ts
test("policy all: a member without TOTP gets 401 mfa_enrolment_required on every tenant route", async () => {   // AC-M0-02
  await setPolicy(t, { mode: "all", roles: [] })
  for (const path of tenantGetRoutes(app)) {
    const r = await call(app, "GET", path, { cookie: staff, tenant: t.slug })
    expect([r.status, (await r.clone().json()).code]).toEqual([401, "mfa_enrolment_required"])
  }
})
test("policy roles: only listed roles are gated", async () => {
  await setPolicy(t, { mode: "roles", roles: ["manager"] })
  expect((await call(app, "GET", "/v1/roles", { cookie: staff, tenant: t.slug })).status).not.toBe(401)
  expect((await call(app, "GET", "/v1/roles", { cookie: manager, tenant: t.slug })).status).toBe(401)
})
test("enrolled but not verified this session is 401 mfa_challenge; after verify-totp it is 200", async () => {})
test("totp accepts one previous step, rejects two", async () => {   // Review Focus #4
  expect(await verifyAt(secret, clock.now() - 30_000)).toBe(true)
  expect(await verifyAt(secret, clock.now() - 61_000)).toBe(false)
})
test("invalid policy body is 422 (unknown role id)", async () => {})
test("policy change is audited with old and new value", async () => {})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `enforceMfa`: if `mfaRequired(tenant.mfaPolicy, member.roleKey)` and user has no TOTP → `Unauthorized("mfa_enrolment_required")`; enrolled and `!session.mfaPassed` → `Unauthorized("mfa_challenge")`. TOTP window ±1 step (Better Auth `twoFactor({ totpOptions: { period: 30 } })`, verify window 1).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): totp mfa with per-tenant forced policy`

### Task T1.6: Teams and reporting lines

**Files:**
- Create: `api/src/db/schema/teams.ts` (`teams(id, tenant_id, name, kind 'team'|'department')`, `team_members(tenant_id, team_id, user_id)` pk `(team_id,user_id)`, `reporting_lines(tenant_id, user_id pk, manager_id)`), `api/src/modules/teams/*`
- Test: `api/src/modules/teams/teams.test.ts`

**Interfaces:** Produces `GET/POST/PATCH/DELETE /v1/teams`, `PUT /v1/teams/:id/members`, `PUT /v1/members/:userId/manager { managerId }`, `GET /v1/people?scope=own|team|all` (scope from `reportScope(role, meId)`), `directReports(tx, managerId): Promise<string[]>`.

- [ ] **Step 1: Write the failing tests**

```ts
test("a member can be in several teams", async () => { /* add to 2 teams → GET /v1/teams?member=u → 2 */ })
test("a member has exactly one primary manager; setting again replaces it", async () => {})
test("reporting cycle A→B→A is rejected with 409 reporting_cycle", async () => {})
test("self as manager is 422", async () => {})
test("people?scope=team returns only direct reports for a manager role", async () => {})
test("people?scope=all is 403 for a staff role", async () => {})
test("departments are teams with kind=department (A.5)", async () => {})
test("team id from another tenant is 404", async () => {})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Cycle check with a recursive CTE walking `manager_id` up from the proposed manager.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): teams, departments and reporting lines`

### Task T1.7: Device register and per-request device policy

**Files:**
- Create: `api/src/db/schema/devices.ts` (`devices(id, tenant_id, user_id, type, owner, label, trusted, last_seen_at)`, `device_policies(tenant_id, feature, allow)` pk `(tenant_id, feature)`), `api/src/core/middleware/device.ts`, `api/src/modules/devices/*`
- Test: `api/src/modules/devices/devices.test.ts`

**Interfaces:**
- Consumes `canUse`, `resolveDevice`, `unregisteredDevice`, `withholdDriveLinks`, `parsePolicies` from `@opsdesk/domain/devices`.
- Produces `loadDevice` (reads signed cookie `od-device` → device row; missing/unknown/other user → `unregisteredDevice()`; runs on every tenant request), `requireFeatureOnDevice(feature)` (403 `device_policy`), `driveAllowed(c): boolean` for later modules to strip Drive URLs, routes `GET/POST/PATCH /v1/devices`, `PUT /v1/device-policies/:feature { allow }`, test-only `GET /v1/_probe/drive-links` returning `withholdDriveLinks` output when `!driveAllowed(c)`.

- [ ] **Step 1: Write the failing tests**

```ts
test("register a device with type, owner, allocated user and trusted flag", async () => {})   // FR-M0-08
test("policy drive=trusted-company-pc: trusted PC sees links, android and unregistered do not", async () => {   // AC-M0-03
  await putPolicy(t, "drive", "trusted-company-pc")
  expect(await driveProbe({ device: trustedPc })).toEqual({ links: [driveUrl] })
  expect(await driveProbe({ device: android })).toEqual({ links: [], withheld: 1 })
  expect(await driveProbe({ device: null })).toEqual({ links: [], withheld: 1 })
})
test("trust revoked mid-session withholds drive on next request", async () => {   // Review Focus #3
  expect((await driveProbe({ device: trustedPc })).links).toHaveLength(1)
  await call(app, "PATCH", `/v1/devices/${trustedPc}`, { cookie: admin, tenant: t.slug, body: { trusted: false } })
  expect((await driveProbe({ device: trustedPc })).links).toHaveLength(0)
})
test("a device cookie belonging to another user resolves to unregistered", async () => {})
test("tampered device cookie signature resolves to unregistered", async () => {})
test("requireFeatureOnDevice('payroll') with allow none is 403 device_policy", async () => {})
test("policy and trust changes are audited with old and new value", async () => {})   // AC-M0-04
test("device id from another tenant is 404", async () => {})
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Cookie signed with `BETTER_AUTH_SECRET` (Hono `getSignedCookie`). No caching of device or policy rows between requests (FR-M0-10).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(api): device register and per-request device policy`

### Task T1.8: Cross-tenant isolation walker (AC-M0-01)

**Files:** Create `api/test/isolation.test.ts`, `api/test/route-fixtures.ts`.

**Interfaces:**
- Consumes the OpenAPI document from `GET /v1/openapi.json` and the factories.
- Produces `fixtureIds(tenantId): Promise<Record<string, string>>` — maps each path param name (`id`, `userId`, `feature`, …) to a real record id in that tenant. **Every later phase adds its param names here**; a route whose param has no fixture fails the walker.

- [ ] **Step 1: Write the failing test**

```ts
test("every /v1 route with a path param returns 404 for tenant B ids when called as tenant A", async () => {
  const doc = await (await call(app, "GET", "/v1/openapi.json")).json()
  const idsB = await fixtureIds(tenantB.id)
  const failures: string[] = []
  for (const [path, ops] of Object.entries(doc.paths)) {
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    if (params.length === 0) continue
    for (const p of params) if (!idsB[p]) failures.push(`${path}: no fixture for {${p}}`)
    const url = path.replace(/\{(\w+)\}/g, (_, p) => idsB[p] ?? "missing")
    for (const method of Object.keys(ops)) {
      const r = await call(app, method.toUpperCase(), url, { cookie: ownerOfA, tenant: tenantA.slug, body: {} })
      if (r.status !== 404) failures.push(`${method.toUpperCase()} ${path} → ${r.status}`)
    }
  }
  expect(failures).toEqual([])
})
test("every /v1 route is registered through OpenAPI (no hidden routes)", () => {
  // compare app.routes (excluding /api/auth/*, /healthz, /readyz, /v1/openapi.json, /v1/_probe/*) with doc.paths
})
```

- [ ] **Step 2: Run** → FAIL until fixtures exist for every param used by T1.3–T1.7.
- [ ] **Step 3: Implement** `fixtureIds` using the factories (one role, team, device, invite, member per tenant).
- [ ] **Step 4: Run** `npm -w api test` → whole suite PASS.
- [ ] **Step 5: Commit** `test(api): cross-tenant isolation walker over all routes`

---

## Done criteria for B0 + B1

- `npm test`, `npm run typecheck`, `npm run build`, `npm -w api test` all green locally and in CI.
- AC-M0-01 (walker), AC-M0-02 (T1.5), AC-M0-03 (T1.7), AC-M0-04 (T1.2/T1.4/T1.5/T1.7) each have a passing test. AC-M0-05 belongs to B3.
- The web app still runs on mock data (switch-over is B6).
