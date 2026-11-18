// Load-test data (B7 Task 17): ONE tenant (`loadtest`) with N users (default 250), M tasks (default 10 000), a daily shift all of them report on, and a
// users file of session cookies for k6 (load/.users.json, gitignored). LOCAL / throwaway databases only.
//   ALLOW_DEMO_SEED=1 SEED_DEMO_PASSWORD=... DATABASE_URL=... DATABASE_OWNER_URL=... BETTER_AUTH_SECRET=... APP_URL=... npm run load:prepare -- [--users 250] [--tasks 10000] [--out load/.users.json]
//
// It reuses the demo seed's guards and building blocks (seed/demo/guards.ts, users.ts) and adds its own, all checked before any write:
//   - ALLOW_DEMO_SEED=1 always; NODE_ENV=production additionally needs ALLOW_LOAD_SEED=1
//   - both database URLs are on localhost, and they are ONE database (assertSameDatabase)
//   - the database holds no tenant other than `loadtest` and the three demo tenants, and no account outside the demo email domain: it never touches non-demo data
//   - the `loadtest` tenant must not exist yet (use a fresh database: `npm run e2e:stack:down && npm run e2e:stack`)
// Prints counts and file names only: never the password, never a cookie.
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { count, eq, notInArray, sql } from "drizzle-orm"
import "../src/modules/audit" // first: a latent import cycle (see app.ts) needs the audit module loaded before anything that imports core/middleware/permission
import { makeDb, type Db } from "../src/db/client"
import { errorInfo } from "../src/core/safe-error"
import { memberships, subscriptions, tenants, user } from "../src/db/schema"
import { withTenant } from "../src/db/tenant-tx"
import { indexDocument } from "../src/modules/search"
import { createPattern, createAssignment, setTeamReporting } from "../src/modules/shifts/service"
import type { ShiftCtx } from "../src/modules/shifts/scope"
import { lockActor } from "../src/modules/rbac/service"
import { createTeam, setTeamMembers } from "../src/modules/teams/service"
import { seedRoleTemplates } from "../src/modules/tenants"
import { assertSameDatabase, DEMO_SLUGS, takeSeedLock } from "../src/seed/demo/guards"
import { buildSeedAuth, noopMailer } from "../src/seed/demo/users"

export const LOAD_SLUG = "loadtest"
export const LOAD_DOMAIN = "demo.example"
export const DEFAULT_USERS = 250
export const DEFAULT_TASKS = 10_000
const OPS_COUNT = 10 // all-scope managers: they get the manager dashboard
const MAX_USERS = 2000
const MAX_TASKS = 200_000

export type LoadRefusal = "opt_in_required" | "load_opt_in_required" | "not_local" | "other_tenants" | "foreign_users" | "tenant_exists" | "bad_size" | "password_required" | "auth_env_missing" | "connections_differ"
export class LoadRefused extends Error {
  constructor(public readonly code: LoadRefusal) {
    super(`load prepare refused: ${code}`)
    this.name = "LoadRefused"
  }
}

export type LoadUser = { email: string; role: "owner" | "ops" | "employee"; cookie: string }
/** What k6 reads (load/k6/lib.js). Cookies are session credentials of throwaway users on a local database; the file is gitignored and never printed. */
export type UsersFile = { tenant: string; patternId: string; today: string; users: LoadUser[] }

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])
/** The URL's own host (parsed, not pattern-matched) is local, and no `host`/`hostaddr` query parameter can send the connection elsewhere (node-postgres lets the query override the host). */
export function isLocalUrl(u: string | undefined): boolean {
  if (typeof u !== "string") return false
  try {
    const x = new URL(u)
    return LOCAL_HOSTS.has(x.hostname) && !x.searchParams.has("host") && !x.searchParams.has("hostaddr")
  } catch {
    return false
  }
}

/** The shape k6 reads. Pure, so the test can check it without a database. */
export function buildUsersFile(o: { tenant: string; patternId: string; today: string; users: LoadUser[] }): UsersFile {
  return { tenant: o.tenant, patternId: o.patternId, today: o.today, users: o.users.map((u) => ({ email: u.email, role: u.role, cookie: u.cookie })) }
}

export type LoadOptions = {
  env: { NODE_ENV?: string; ALLOW_DEMO_SEED?: string; ALLOW_LOAD_SEED?: string }
  /** The two connection strings, only to prove they are local. */
  urls: { app: string | undefined; owner: string | undefined }
  db: Db
  owner: Db
  clock: { now(): Date }
  password: string
  users?: number
  tasks?: number
  authEnv: { BETTER_AUTH_SECRET?: string; APP_URL?: string }
  timezone?: string
}

/** Every refusal of the load seed. Reads only. */
export async function assertLoadAllowed(o: Pick<LoadOptions, "env" | "urls" | "db" | "owner" | "users" | "tasks" | "password" | "authEnv">): Promise<void> {
  if (o.env.ALLOW_DEMO_SEED !== "1") throw new LoadRefused("opt_in_required")
  if (o.env.NODE_ENV === "production" && o.env.ALLOW_LOAD_SEED !== "1") throw new LoadRefused("load_opt_in_required")
  if (!isLocalUrl(o.urls.app) || !isLocalUrl(o.urls.owner)) throw new LoadRefused("not_local")
  const users = o.users ?? DEFAULT_USERS
  const tasks = o.tasks ?? DEFAULT_TASKS
  if (!Number.isInteger(users) || users < OPS_COUNT + 2 || users > MAX_USERS || !Number.isInteger(tasks) || tasks < 0 || tasks > MAX_TASKS) throw new LoadRefused("bad_size")
  if (typeof o.password !== "string" || o.password.length < 12) throw new LoadRefused("password_required")
  if (!o.authEnv.BETTER_AUTH_SECRET || !o.authEnv.APP_URL) throw new LoadRefused("auth_env_missing")
  for (const c of [o.owner, o.db]) {
    const [other] = await c.select({ n: count() }).from(tenants).where(notInArray(tenants.slug, [LOAD_SLUG, ...DEMO_SLUGS]))
    if (Number(other.n) > 0) throw new LoadRefused("other_tenants")
    const [foreign] = await c.select({ n: count() }).from(user).where(sql`lower(${user.email}) not like ${"%@" + LOAD_DOMAIN}`)
    if (Number(foreign.n) > 0) throw new LoadRefused("foreign_users")
    const [have] = await c.select({ n: count() }).from(tenants).where(eq(tenants.slug, LOAD_SLUG))
    if (Number(have.n) > 0) throw new LoadRefused("tenant_exists")
  }
  await assertSameDatabase(o.db, o.owner).catch(() => {
    throw new LoadRefused("connections_differ")
  })
}

const pad = (n: number) => String(n).padStart(4, "0")

/** Seeds the load tenant and returns the users file content. */
export async function prepareLoad(o: LoadOptions): Promise<{ file: UsersFile; counts: Record<string, number> }> {
  await assertLoadAllowed(o)
  const nUsers = o.users ?? DEFAULT_USERS
  const nTasks = o.tasks ?? DEFAULT_TASKS
  const tz = o.timezone ?? "Europe/Dublin"
  const now = o.clock.now()
  const unlock = await takeSeedLock(o.owner, { timeoutMs: 30_000 })
  try {
    await assertLoadAllowed(o) // again under the lock, immediately before the first write
    const auth = buildSeedAuth(o.db, { BETTER_AUTH_SECRET: o.authEnv.BETTER_AUTH_SECRET!, APP_URL: o.authEnv.APP_URL!, NODE_ENV: o.env.NODE_ENV }, noopMailer(), o.clock)
    // ---- users: Better Auth's own sign-up (scrypt hash), verified; the session cookie comes from its own sign-in, in process (no rate limit, no web) ----
    const people: { email: string; name: string; role: LoadUser["role"]; id: string; cookie: string }[] = []
    for (let i = 1; i <= nUsers; i++) {
      const email = `load-${pad(i)}@${LOAD_DOMAIN}`
      const name = `Load User ${pad(i)}`
      const created = await auth.api.signUpEmail({ body: { email, password: o.password, name } })
      await o.db.update(user).set({ emailVerified: true }).where(eq(user.id, created.user.id))
      const login = await auth.api.signInEmail({ body: { email, password: o.password }, returnHeaders: true })
      const cookie = login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")
      if (!cookie) throw new Error("sign-in set no cookie")
      people.push({ email, name, role: i === 1 ? "owner" : i <= 1 + OPS_COUNT ? "ops" : "employee", id: created.user.id, cookie })
    }
    // ---- the tenant: no tenant-creation service (it makes the first user the owner of a trial); the same rows the test factory writes, an active business plan ----
    const [t] = await o.db.insert(tenants).values({ slug: LOAD_SLUG, name: "Load test", timezone: tz, sessionIdleHours: 2160 }).returning({ id: tenants.id })
    const tenantId = t.id
    const ownerId = people[0].id
    const nowIso = now.toISOString()
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(now)
    let patternId = ""
    await withTenant(o.db, tenantId, async (tx) => {
      const roleIds = await seedRoleTemplates(tx, tenantId)
      await tx.insert(subscriptions).values({ tenantId, planId: "business", status: "active", seats: nUsers + 10, trialEndsAt: null })
      await tx.insert(memberships).values(people.map((p) => ({ tenantId, userId: p.id, roleId: roleIds.get(p.role)!, joinedAt: now })))
      const team = await createTeam(tx, tenantId, { userId: ownerId }, { name: "Load team", kind: "team" }, now)
      await setTeamMembers(tx, tenantId, { userId: ownerId }, team.id, people.map((p) => p.id), now)
      const role = await lockActor(tx, tenantId, ownerId, "shifts", "write")
      const sctx: ShiftCtx = { tenantId, tz, me: ownerId, actorId: ownerId, role, view: "all", write: "all", reports: [], now }
      const pattern = await createPattern(tx, sctx, { name: "Day", teamId: team.id, start: "09:00", end: "17:00", days: [0, 1, 2, 3, 4, 5, 6] })
      patternId = pattern.id
      for (const p of people) await createAssignment(tx, sctx, { userId: p.id, patternId, from: addDays(today, -90), until: null })
      await setTeamReporting(tx, sctx, team.id, true)
      for (const p of people) await indexDocument(tx, { tenantId, entity: "member", entityId: p.id, module: "staff", title: p.name, body: p.role }, now)
      // tasks: spread around today (overdue, due today, future), every status, assigned round-robin to the employees; the evidence rows feed the dashboard's pending tile
      await tx.execute(sql`
        with emp as (select user_id, row_number() over (order by user_id) rn, count(*) over () cnt from memberships where tenant_id = ${tenantId} and role_id = ${roleIds.get("employee")!})
        , ins as (
          insert into tasks (tenant_id, ref_no, title, description, evidence_rule, status, priority, start_at, due_at, completed_at, created_at, updated_at, creator_id)
          select ${tenantId}::uuid, g, 'Load task ' || g, 'Check the area and report.', '{"mode":"none","types":[],"min":0,"instruction":"","review":"manager"}'::jsonb,
            (array['not_started','in_progress','blocked','submitted','completed','completed','changes_requested','cancelled'])[1 + g % 8], 1 + g % 3,
            date_trunc('day', ${nowIso}::timestamptz) + (((g % 21) - 7) || ' days')::interval, date_trunc('day', ${nowIso}::timestamptz) + (((g % 21) - 7) || ' days')::interval + ((1 + g % 10) || ' hours')::interval,
            case when g % 8 in (4, 5) then ${nowIso}::timestamptz - ((g % 48) || ' hours')::interval end, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${ownerId}
          from generate_series(1, ${nTasks}::int) g
          returning id, ref_no, title
        ), asg as (
          insert into task_assignees (tenant_id, task_id, user_id, is_primary)
          select ${tenantId}::uuid, ins.id, emp.user_id, true from ins join emp on emp.rn = 1 + ins.ref_no % emp.cnt
          returning task_id, user_id
        ), ev as (
          insert into task_evidence (tenant_id, task_id, round, kind, text, review, created_at)
          select ${tenantId}::uuid, id, 1, 'note', 'n', case when ref_no % 3 = 0 then 'pending' else 'accepted' end, ${nowIso}::timestamptz from ins
          returning 1
        )
        insert into search_documents (tenant_id, entity, entity_id, module, title, body, audience, updated_at)
        select ${tenantId}::uuid, 'task', ins.id, 'tasks', 'TSK-' || ins.ref_no || ' ' || ins.title, 'Check the area and report.', array['a:' || asg.user_id, 'o:' || ${ownerId}::text], ${nowIso}::timestamptz from ins join asg on asg.task_id = ins.id`)
    })
    await o.owner.execute(sql`analyze`)
    const file = buildUsersFile({ tenant: LOAD_SLUG, patternId, today, users: people.map((p) => ({ email: p.email, role: p.role, cookie: p.cookie })) })
    return { file, counts: { users: nUsers, tasks: nTasks, ops: OPS_COUNT } }
  } finally {
    await unlock()
  }
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function parseArgs(argv: string[]): { users?: number; tasks?: number; out: string } | null {
  const out = { out: fileURLToPath(new URL("../../load/.users.json", import.meta.url)) } as { users?: number; tasks?: number; out: string }
  for (let i = 0; i < argv.length; i += 2) {
    const [k, v] = [argv[i], argv[i + 1]]
    if (v === undefined) return null
    if (k === "--users") out.users = Number(v)
    else if (k === "--tasks") out.tasks = Number(v)
    else if (k === "--out") out.out = v
    else return null
  }
  return out
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (!args) {
    console.error("usage: ALLOW_DEMO_SEED=1 SEED_DEMO_PASSWORD=... npm run load:prepare -- [--users 250] [--tasks 10000] [--out path]")
    return 2
  }
  const [appUrl, ownerUrl] = [process.env.DATABASE_URL, process.env.DATABASE_OWNER_URL]
  if (!appUrl || !ownerUrl) {
    console.error("DATABASE_URL and DATABASE_OWNER_URL are required")
    return 2
  }
  const started = Date.now()
  const db = makeDb(appUrl, { max: 2 })
  const owner = makeDb(ownerUrl, { max: 2 })
  try {
    const r = await prepareLoad({
      env: { NODE_ENV: process.env.NODE_ENV, ALLOW_DEMO_SEED: process.env.ALLOW_DEMO_SEED, ALLOW_LOAD_SEED: process.env.ALLOW_LOAD_SEED },
      urls: { app: appUrl, owner: ownerUrl },
      db, owner, clock: { now: () => new Date() }, password: process.env.SEED_DEMO_PASSWORD as string, users: args.users, tasks: args.tasks,
      authEnv: { BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET, APP_URL: process.env.APP_URL },
    })
    mkdirSync(dirname(args.out), { recursive: true })
    writeFileSync(args.out, JSON.stringify(r.file), { mode: 0o600 })
    console.log(`prepared tenant ${LOAD_SLUG}: ${Object.entries(r.counts).map(([k, v]) => `${k}=${v}`).join(" ")} in ${((Date.now() - started) / 1000).toFixed(1)}s; users file: ${args.out}`)
    return 0
  } catch (err) {
    if (err instanceof LoadRefused) {
      console.error(`refused: ${err.code}`)
      return 1
    }
    const info = errorInfo(err)
    console.error(`failed: ${info.name}${info.code ? ` ${info.code}` : ""}`)
    return 1
  } finally {
    await db.$client.end()
    await owner.$client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
