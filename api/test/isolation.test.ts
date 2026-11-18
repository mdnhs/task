import { beforeAll, describe, expect, test } from "vitest"
import { sql } from "drizzle-orm"
import { call, resetDb, testApp } from "./harness"
import { ownerTenantQuery, ownerQuery } from "./db"
import { makeMember, makeTenant, signIn } from "./factories"
import { actorIn, fixtureFutureUntil, fixtureIds, ROUTE_PARAMS, type Actor, type World } from "./route-fixtures"
import { memberships, roles } from "../src/db/schema"
import { HASHED_TABLES, TABLE_EXEMPT } from "./isolation-tables"
import { ROUTE_CLASSIFICATION } from "./route-classification"

/**
 * AC-M0-01: cross-tenant isolation walker. It gates every release.
 *
 * As the OWNER of tenant A (X-Tenant: A), every OpenAPI operation that has a path param is called with tenant B's
 * record ids. Each must answer 404 (never 403, never 2xx), with a problem+json body that leaks nothing of B.
 * It is built so it cannot pass vacuously:
 *  - a route with a path param but no fixture, or a JSON body without an `example` (R5), FAILS by name;
 *  - a control run calls the same operations with tenant A's OWN ids and requires "not 404" (so the route exists,
 *    the body validates and the handler really reaches the lookup);
 *  - B's 404 must carry the same error code as a never-existing id (B's data is indistinguishable from absent);
 *  - B's data (row hashes) must be identical before and after the walk (no cross-tenant write got through).
 *
 * Completeness (B7 Task 14), so the gate cannot be outrun:
 *  - route-inventory.test.ts derives every route from the OpenAPI document and requires a classification (route-classification.ts);
 *    the "tenant-record" routes there must be EXACTLY the SPECS + NOT_APPLICABLE keys of this file (test below), so a new route
 *    with a tenant record id fails until it has a spec;
 *  - the hashed table list (isolation-tables.ts) must equal every table with a tenant_id column (the RLS-guard list);
 *  - platform routes: platform-isolation.test.ts (ruling C4), blocking in CI like this file.
 */

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
const METHODS = ["get", "put", "post", "delete", "patch"]
const NIL_UUID = "00000000-0000-4000-8000-000000000000"

/**
 * EXPLICIT EXCLUSIONS from the "404 for tenant B's id" assertion. There is no other skip in this file.
 * A route is excluded only when NONE of its path params is a tenant record id (all are `kind: "static"`):
 * the param is a fixed vocabulary word and the row is addressed by the caller's tenant, never by the param.
 * Those are still exercised, with the stronger check in the "static-param routes" test below.
 */
const NOT_APPLICABLE: Record<string, string> = {
  "PUT /v1/device-policies/{feature}": "{feature} is a vocabulary word (drive|payroll); the policy row is keyed by the caller's tenant. Checked instead: B's policies are unchanged by A's PUT.",
}

/**
 * One spec per operation, used by BOTH the B-walk and the control run: the same actor, the same body, only the
 * path ids differ (A's own vs B's). So the only thing that can turn the call into a 404 for B's ids is the tenant
 * boundary. `expect` is the resource-specific 404 code the lookup of the path id throws (any other 404, e.g. a
 * body-role lookup failing first, fails the walker). A route without a spec fails the walker.
 *  - "owner": owner of A.  - "dual": a member of BOTH A and B, the allocated user of a device in A and one in B.
 * `body(w)` gets the world whose ids are in the path (so bind can use a code issued for that very device).
 */
type Spec = { actor: "owner" | "dual"; expect: string; body?: (w: World) => Promise<unknown> | unknown; prepare?: (w: World) => Promise<void> }
const issueCode = async (w: World) => {
  const r = await call(t.app, "POST", `/v1/devices/${w.resources.device}/enrolment-code`, { cookie: w.owner.cookie, tenant: w.tenant.slug })
  if (r.status !== 201) throw new Error(`enrolment code failed: ${r.status}`)
  return { code: ((await r.json()) as Json).code }
}
/** The control run for restore / purge needs an ARCHIVED task of A: archive the fresh fixture task through the real API as A's owner. */
const archiveFixtureTask = async (w: World) => {
  const r = await call(t.app, "POST", `/v1/tasks/${w.resources.task}/archive`, { cookie: w.owner.cookie, tenant: w.tenant.slug, body: { version: 1 } })
  if (r.status !== 200) throw new Error(`fixture archive failed: ${r.status} ${await r.text()}`)
}
/** The control run for play / clear needs a task WITH a voice note: point A's fixture task at its (unfinished) attachment upload, as the API would after a clean scan. */
const voiceFixture = async (w: World) => {
  await ownerTenantQuery(w.tenant.id, "update tasks set voice_file_id = $2, voice_meta = $3::jsonb where id = $1", [w.resources.task, w.resources.taskFile, JSON.stringify({ durationSec: 5, mime: "audio/webm", recordedBy: "x", recordedAt: "2026-11-16T09:00:00.000Z" })])
}
const SPECS: Record<string, Spec> = {
  "POST /v1/roles/{id}/clone": { actor: "owner", expect: "role_not_found" },
  "PATCH /v1/roles/{id}": { actor: "owner", expect: "role_not_found" },
  // body role is a REAL role of A: role lookup passes in both runs, so only the member lookup can 404
  "PATCH /v1/members/{userId}": { actor: "owner", expect: "member_not_found", body: () => ({ roleId: a.resources.role }) },
  "PUT /v1/members/{userId}/manager": { actor: "owner", expect: "member_not_found", body: () => ({ managerId: null }) },
  "PATCH /v1/teams/{id}": { actor: "owner", expect: "team_not_found" },
  "DELETE /v1/teams/{id}": { actor: "owner", expect: "team_not_found" },
  "PUT /v1/teams/{id}/members": { actor: "owner", expect: "team_not_found", body: () => ({ userIds: [a.resources.member] }) },
  "PATCH /v1/devices/{id}": { actor: "owner", expect: "device_not_found" },
  "POST /v1/devices/{id}/enrolment-code": { actor: "owner", expect: "device_not_found" },
  // actor is the allocated user of the device in BOTH tenants, with a live code issued for that exact device
  "POST /v1/devices/{id}/bind": { actor: "dual", expect: "device_not_found", body: issueCode },
  // the acting owner of A owns the A fixtures; B's ids belong to B's owner (own-notification rule + RLS)
  "POST /v1/notifications/{id}/read": { actor: "owner", expect: "notification_not_found" },
  "DELETE /v1/me/push-tokens/{id}": { actor: "owner", expect: "push_token_not_found" },
  // T6.3: another (non-current) session of the acting owner (control: 204). A session id of another user's is 404, like a never-existing one
  "DELETE /v1/me/sessions/{id}": { actor: "owner", expect: "session_not_found" },
  // T6.5: a pending invite of A (control: DELETE 204, resend 429 resend_too_soon because the fixture was issued a moment ago) and retiring A's device (control: 204)
  "DELETE /v1/invites/{id}": { actor: "owner", expect: "invite_not_found" },
  "POST /v1/invites/{id}/resend": { actor: "owner", expect: "invite_not_found" },
  "DELETE /v1/devices/{id}": { actor: "owner", expect: "device_not_found" },
  // a pending, never-uploaded file of A: GET 200, complete 409 upload_missing, download 409 file_not_ready, delete 204 (all "not 404")
  "GET /v1/files/{id}": { actor: "owner", expect: "file_not_found" },
  "POST /v1/files/{id}/complete": { actor: "owner", expect: "file_not_found" },
  "GET /v1/files/{id}/download": { actor: "owner", expect: "file_not_found" },
  "DELETE /v1/files/{id}": { actor: "owner", expect: "file_not_found" },
  // the tenant's google connection (control: DELETE -> 204)
  "DELETE /v1/integrations/{id}": { actor: "owner", expect: "integration_not_found" },
  // a pending `correct` request of A about its staff member (control: GET 200, complete 200, reject 200)
  "GET /v1/data-requests/{id}": { actor: "owner", expect: "data_request_not_found" },
  "POST /v1/data-requests/{id}/complete": { actor: "owner", expect: "data_request_not_found" },
  "POST /v1/data-requests/{id}/reject": { actor: "owner", expect: "data_request_not_found" },
  "POST /v1/data-requests/{id}/retry": { actor: "owner", expect: "data_request_not_found" }, // control: 409 request_not_failed (not 404)
  // an active support grant of A (control: owner revokes it -> 200)
  "DELETE /v1/settings/support-grants/{id}": { actor: "owner", expect: "grant_not_found" },
  // T3.6: an API key (control: revoke -> 200) and a webhook endpoint (control: PATCH -> 200, DELETE -> 204) of A
  "DELETE /v1/api-keys/{id}": { actor: "owner", expect: "api_key_not_found" },
  "PATCH /v1/webhooks/{id}": { actor: "owner", expect: "webhook_not_found" },
  "DELETE /v1/webhooks/{id}": { actor: "owner", expect: "webhook_not_found" },
  // B4 (T4.1): a task of A assigned to its staff member (control: GET 200, PATCH 200, assignees 200, status 200, complete 200, history 200)
  "GET /v1/tasks/{id}": { actor: "owner", expect: "task_not_found" },
  "PATCH /v1/tasks/{id}": { actor: "owner", expect: "task_not_found" },
  "PUT /v1/tasks/{id}/assignees": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/status": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/complete": { actor: "owner", expect: "task_not_found" },
  "GET /v1/tasks/{id}/history": { actor: "owner", expect: "task_not_found" },
  // B4 (T4.2): a checklist item, a comment and an unfinished attachment upload of A's task (the task id is looked up first: 404 task_not_found)
  "POST /v1/tasks/{id}/checklist": { actor: "owner", expect: "task_not_found" },
  "PATCH /v1/tasks/{id}/checklist/{itemId}": { actor: "owner", expect: "task_not_found" },
  "DELETE /v1/tasks/{id}/checklist/{itemId}": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/subtasks": { actor: "owner", expect: "task_not_found" },
  "GET /v1/tasks/{id}/comments": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/comments": { actor: "owner", expect: "task_not_found" },
  "DELETE /v1/tasks/{id}/comments/{commentId}": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/uploads": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/uploads/{fileId}/complete": { actor: "owner", expect: "task_not_found" }, // control: 409 upload_missing
  "GET /v1/tasks/{id}/files/{fileId}/download": { actor: "owner", expect: "task_not_found" }, // control: 409 file_not_ready
  // T4.3: dependencies (control: 422 invalid_dependency for the example's made-up id), knock-on (control: 200), date proposals (control: 403 for the
  // owner who is not an assignee, then 422 no_proposal), projects (control: 200 / 204) and milestones
  "PUT /v1/tasks/{id}/dependencies": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/reschedule/preview": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/reschedule": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/date-proposal": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/date-proposal/approve": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/date-proposal/decline": { actor: "owner", expect: "task_not_found" },
  "GET /v1/projects/{id}": { actor: "owner", expect: "project_not_found" },
  "PATCH /v1/projects/{id}": { actor: "owner", expect: "project_not_found" },
  "DELETE /v1/projects/{id}": { actor: "owner", expect: "project_not_found" },
  "POST /v1/projects/{id}/milestones": { actor: "owner", expect: "project_not_found" },
  "PATCH /v1/projects/{id}/milestones/{milestoneId}": { actor: "owner", expect: "project_not_found" }, // B's project id is looked up first
  "DELETE /v1/projects/{id}/milestones/{milestoneId}": { actor: "owner", expect: "project_not_found" },
  // T4.4: a repeat rule on A's task (control: 200) and a task template of A (control: PATCH 200, DELETE 204)
  "PUT /v1/tasks/{id}/repeat": { actor: "owner", expect: "task_not_found" },
  // T4.5: archive (control: 200), restore and purge (control: the fixture task is archived first, then restore 200 / purge 204)
  "POST /v1/tasks/{id}/archive": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/restore": { actor: "owner", expect: "task_not_found", prepare: archiveFixtureTask },
  "DELETE /v1/tasks/{id}": { actor: "owner", expect: "task_not_found", prepare: archiveFixtureTask },
  // T4.6: evidence rule (control: 200), attach (control: 201 with a note), delete (control: 204), download (control: 409 file_not_ready), verify and reject
  // (control: 409 invalid_transition, the fixture task is not submitted)
  // T4.7: voice note. Set (control: 422 voice_too_long for the example's 121 s, which is checked right after the task lookup), play and clear (control: the fixture task
  // gets a voice_file_id first, pointing at its still-uploading attachment: 409 file_not_ready / 200), and the play log (control: 200 for the owner, a manager)
  "PUT /v1/tasks/{id}/voice-note": { actor: "owner", expect: "task_not_found", body: () => ({ version: 1, fileId: NIL_UUID, durationSec: 121 }) },
  "GET /v1/tasks/{id}/voice-note": { actor: "owner", expect: "task_not_found", prepare: voiceFixture },
  "DELETE /v1/tasks/{id}/voice-note": { actor: "owner", expect: "task_not_found", prepare: voiceFixture },
  "GET /v1/tasks/{id}/voice-note/plays": { actor: "owner", expect: "task_not_found" },
  "PUT /v1/tasks/{id}/evidence-rule": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/evidence": { actor: "owner", expect: "task_not_found", body: () => ({ kind: "note", text: "Walked every floor" }) },
  "DELETE /v1/tasks/{id}/evidence/{evidenceId}": { actor: "owner", expect: "task_not_found" },
  "GET /v1/tasks/{id}/evidence/{evidenceId}/download": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/verify": { actor: "owner", expect: "task_not_found" },
  "POST /v1/tasks/{id}/reject": { actor: "owner", expect: "task_not_found" },
  // B8 T5: locations, shift types, targets, supervisors (controls: GET/PATCH/archive/shift types 200 or 201, supervisors 422 invalid_supervisor for the example's unknown user, office limit 422 not_roster_office for the staff fixture).
  // A site the caller cannot see, one that does not exist and another tenant's are the same plain 404 not_found (R8-4); a shift type shares that code so a hidden site shows no difference.
  "GET /v1/locations/{id}": { actor: "owner", expect: "not_found" },
  "PATCH /v1/locations/{id}": { actor: "owner", expect: "not_found" },
  "POST /v1/locations/{id}/archive": { actor: "owner", expect: "not_found" },
  "PUT /v1/locations/{id}/supervisors": { actor: "owner", expect: "not_found" },
  "GET /v1/locations/{id}/shift-types": { actor: "owner", expect: "not_found" },
  "POST /v1/locations/{id}/shift-types": { actor: "owner", expect: "not_found" },
  "PATCH /v1/shift-types/{id}": { actor: "owner", expect: "not_found" },
  "DELETE /v1/shift-types/{id}": { actor: "owner", expect: "not_found" },
  "PUT /v1/shift-types/{id}/targets": { actor: "owner", expect: "not_found" },
  "PUT /v1/roster/office-limits/{userId}": { actor: "owner", expect: "member_not_found" },
  "PATCH /v1/task-templates/{id}": { actor: "owner", expect: "template_not_found" },
  "DELETE /v1/task-templates/{id}": { actor: "owner", expect: "template_not_found" },
  // T5.1: shift patterns (control: PATCH 200, DELETE 204), assignments (control: PATCH 200 with an end date after the fixture's start, DELETE 204 for the future one),
  // team defaults (control: 200) and per-person overrides (control: 200; the ghost user id is 404 not_a_member)
  "PATCH /v1/shifts/patterns/{id}": { actor: "owner", expect: "shift_pattern_not_found" },
  "DELETE /v1/shifts/patterns/{id}": { actor: "owner", expect: "shift_pattern_not_found" },
  "PATCH /v1/shifts/assignments/{id}": { actor: "owner", expect: "shift_assignment_not_found", body: () => ({ until: fixtureFutureUntil() }) },
  "DELETE /v1/shifts/assignments/{id}": { actor: "owner", expect: "shift_assignment_not_found" },
  "PUT /v1/shifts/reporting/teams/{teamId}": { actor: "owner", expect: "team_not_found" },
  "PUT /v1/shifts/reporting/people/{userId}": { actor: "owner", expect: "not_a_member" },
  // T5.2: shift reports of A's owner (controls: GET 200, PUT draft 422 item_not_in_shift for the example's unknown task, submit 409 version_conflict for the example's version 2,
  // versions 200, upload intent 201, complete 409 upload_missing for the never-PUT fixture file, download 409 file_not_ready)
  "GET /v1/shift-reports/{id}": { actor: "owner", expect: "report_not_found" },
  "PUT /v1/shift-reports/{id}/draft": { actor: "owner", expect: "report_not_found" },
  "POST /v1/shift-reports/{id}/submit": { actor: "owner", expect: "report_not_found" },
  // T5.3: review (control: 403 self_review, the fixture report is the OWNER'S own and the independence check comes before version and state; B's id is looked up first: 404)
  "POST /v1/shift-reports/{id}/accept": { actor: "owner", expect: "report_not_found" },
  "POST /v1/shift-reports/{id}/return": { actor: "owner", expect: "report_not_found" },
  "GET /v1/shift-reports/{id}/versions": { actor: "owner", expect: "report_not_found" },
  "POST /v1/shift-reports/{id}/uploads": { actor: "owner", expect: "report_not_found" },
  "POST /v1/shift-reports/{id}/uploads/{fileId}/complete": { actor: "owner", expect: "report_not_found" },
  "GET /v1/shift-reports/{id}/files/{fileId}/download": { actor: "owner", expect: "report_not_found" },
  // T5.5: A's owner's own export (controls: status 200, download 409 export_not_ready: the walker's queue never runs the job); B's id is 404 report_export_not_found
  "GET /v1/report-exports/{id}": { actor: "owner", expect: "report_export_not_found" },
  "GET /v1/report-exports/{id}/download": { actor: "owner", expect: "report_export_not_found" },
}

let t: ReturnType<typeof testApp>
let ownerA: Actor
let dual: Actor
let a: World
let b: World
let doc: { paths: Record<string, Record<string, Json>> }

async function buildWorld(tenant: { id: string; slug: string }, deviceUser?: Actor): Promise<World> {
  const owner = await actorIn(t, tenant, "owner")
  const staff = await actorIn(t, tenant, "employee")
  const f = await fixtureIds(t, tenant, owner, staff, deviceUser)
  return { tenant, owner, staff, ...f, marks: [...f.marks, f.resources.role, owner.email, staff.email] }
}

const bodyExample = (op: Json): { present: boolean; example?: unknown } => {
  const schema = op.requestBody?.content?.["application/json"]?.schema as Json | undefined
  if (!op.requestBody) return { present: false }
  return { present: true, example: schema?.example ?? schema?.examples?.[0] }
}

const substitute = (path: string, params: Record<string, string>) => path.replace(/\{(\w+)\}/g, (_, p) => encodeURIComponent(params[p]))

/** Tenant tables whose rows are hashed before and after the walk: any change in the OTHER tenant is a cross-tenant mutation. The list lives in isolation-tables.ts (route-inventory.test.ts requires it to equal every tenant_id table). */

async function hashes(tenantId: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const tbl of HASHED_TABLES) {
    const [r] = await ownerTenantQuery(tenantId, `select count(*)::text || ':' || coalesce(md5(string_agg(to_jsonb(x)::text, ',' order by to_jsonb(x)::text)), '') as h from ${tbl} x`)
    out[tbl] = String(r.h)
  }
  return out
}

beforeAll(async () => {
  await resetDb()
  t = testApp()
  const ta = await makeTenant(t.deps, { slug: "iso-alpha" })
  const tb = await makeTenant(t.deps, { slug: "iso-bravo" })
  // one user in both tenants: signs in once, X-Tenant picks the tenant
  const du = await makeMember(t.deps, ta.id, "employee")
  await makeMember(t.deps, tb.id, "employee", { email: du.email })
  dual = { userId: du.userId, slug: ta.slug, cookie: (await signIn(t.app, du.email, du.password)).cookie }
  a = await buildWorld(ta, dual)
  b = await buildWorld(tb, dual)
  ownerA = a.owner
  doc = (await (await call(t.app, "GET", "/v1/openapi.json")).json()) as typeof doc
}, 120_000)

type Op = { method: string; path: string; key: string; op: Json; params: string[] }
/**
 * Ruling C4: /v1/platform/* is NOT walked with A's owner here. Platform routes are not tenant-scoped (no X-Tenant, no tenant
 * record id in the path: `{userId}` is a platform staff user id) and the staff-by-design ones cannot be called as a tenant owner.
 * The replacement walk is platform-isolation.test.ts (B7 Task 14, blocking in CI like this file): as a non-staff owner of A
 * every platform route is the same 404 as a never-existing route; as staff, `{tenantId}` routes 404 a nil uuid and no secret
 * appears in any body. platform.test.ts keeps the role/MFA gates and the platform audit chain.
 * The route-registration test below still includes them (they must be in the OpenAPI doc).
 */
const PLATFORM = (path: string) => path.startsWith("/v1/platform/")
const operations = (): Op[] =>
  Object.entries(doc.paths).flatMap(([path, item]) => {
    if (PLATFORM(path)) return []
    const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1])
    if (params.length === 0) return []
    return METHODS.filter((m) => item[m]).map((m) => ({ method: m.toUpperCase(), path, key: `${m.toUpperCase()} ${path}`, op: item[m], params }))
  })

describe("AC-M0-01 cross-tenant isolation walker", () => {
  test("every tenant table (any table with a tenant_id column) is in the mutation-hash list or exempt with a reason", async () => {
    const rows = await ownerQuery("select table_name from information_schema.columns where table_schema = 'public' and column_name = 'tenant_id' order by 1")
    const tenantTables = rows.map((r) => String((r as { table_name: string }).table_name))
    expect(tenantTables.length).toBeGreaterThanOrEqual(50)
    expect(tenantTables.filter((x) => !HASHED_TABLES.includes(x) && !(x in TABLE_EXEMPT))).toEqual([])
  })

  test("the SPECS are exactly the manifest's tenant-record routes (a new tenant-record route fails until it has a SPECS entry)", () => {
    const manifest = Object.entries(ROUTE_CLASSIFICATION).filter(([, [c]]) => c === "tenant-record").map(([k]) => k)
    expect(Object.keys(SPECS).sort()).toEqual(manifest.sort())
    for (const k of Object.keys(NOT_APPLICABLE)) expect(ROUTE_CLASSIFICATION[k]?.[0], `${k}: NOT_APPLICABLE routes have only static params, so the manifest says tenant-static`).toBe("tenant-static")
  })

  test("the walk is not vacuous: parameterised routes exist, every one has fixtures and a body example", () => {
    const ops = operations()
    expect(ops.length).toBeGreaterThanOrEqual(10)
    const problems: string[] = []
    for (const o of ops) {
      const fx = b.fixtures[o.path]
      if (!fx) problems.push(`${o.key}: no entry in ROUTE_PARAMS / route-fixtures.ts`)
      for (const p of o.params) if (!fx?.[p]) problems.push(`${o.key}: no fixture for {${p}}`)
      const body = bodyExample(o.op)
      if (body.present && body.example === undefined) problems.push(`${o.key}: JSON body has no .openapi({ example }) (R5)`)
    }
    for (const path of Object.keys(ROUTE_PARAMS)) if (!doc.paths[path]) problems.push(`stale ROUTE_PARAMS entry ${path}: not in the OpenAPI doc`)
    for (const k of Object.keys(NOT_APPLICABLE)) if (!ops.some((o) => o.key === k)) problems.push(`stale NOT_APPLICABLE entry ${k}`)
    expect(problems).toEqual([])
  })

  test("as A, every route with a path param returns the resource-specific 404 problem+json for tenant B's ids and leaks nothing", async () => {
    const ops = operations()
    const failures: string[] = []
    const skipped: string[] = []
    const plan: { o: Op; spec: Spec; body: unknown; params: Record<string, string>; ghost: Record<string, string> }[] = []
    for (const o of ops) {
      const fx = b.fixtures[o.path]
      if (!o.params.some((p) => fx[p].kind === "id")) {
        skipped.push(o.key)
        continue
      }
      const spec = SPECS[o.key]
      if (!spec) {
        failures.push(`${o.key}: no SPECS entry (actor/body/expected 404 code)`)
        continue
      }
      const ex = bodyExample(o.op)
      const body = ex.present ? await (spec.body ? spec.body(b) : ex.example) : undefined // codes are issued BEFORE the snapshot below
      plan.push({
        o, spec, body,
        params: Object.fromEntries(o.params.map((p) => [p, fx[p].value])),
        ghost: Object.fromEntries(o.params.map((p) => [p, fx[p].kind === "id" ? (p === "userId" ? "usr_ghost" : NIL_UUID) : fx[p].value])),
      })
    }
    const before = await hashes(b.tenant.id)
    const walked: string[] = []
    for (const { o, spec, body, params, ghost } of plan) {
      const cookie = spec.actor === "dual" ? dual.cookie : ownerA.cookie
      const send = (url: string) => call(t.app, o.method, url, { cookie, tenant: a.tenant.slug, body })
      const r = await send(substitute(o.path, params))
      walked.push(o.key)
      const text = await r.text()
      const code = (JSON.parse(text) as Json).code
      if (r.status !== 404) failures.push(`${o.key} -> ${r.status} (want 404) ${text.slice(0, 120)}`)
      else if (code !== spec.expect) failures.push(`${o.key}: 404 code ${code}, want ${spec.expect} (a different lookup failed first)`)
      if (!(r.headers.get("content-type") ?? "").startsWith("application/problem+json")) failures.push(`${o.key}: content-type ${r.headers.get("content-type")}`)
      for (const m of b.marks) if (text.includes(m)) failures.push(`${o.key}: 404 body leaks tenant-B value ${m}`)
      // B's id must look exactly like an id that never existed.
      const g = await send(substitute(o.path, ghost))
      if (g.status !== 404 || ((await g.json()) as Json).code !== spec.expect) failures.push(`${o.key}: never-existing id did not give 404 ${spec.expect}`)
    }
    expect(failures).toEqual([])
    expect(walked.length).toBeGreaterThanOrEqual(10)
    expect(walked.length + skipped.length).toBe(ops.length)
    expect(skipped.sort()).toEqual(Object.keys(NOT_APPLICABLE).sort()) // no silent skips
    expect(Object.keys(SPECS).sort()).toEqual(walked.sort()) // no stale spec
    expect(await hashes(b.tenant.id)).toEqual(before) // nothing of B was written, deleted or audited
  }, 120_000)

  test("control: same actor and body, tenant A's OWN ids: not 404 and not 5xx (so the walk really reaches the lookup)", async () => {
    const failures: string[] = []
    for (const o of operations()) {
      if (NOT_APPLICABLE[o.key]) continue
      const spec = SPECS[o.key]
      if (!spec) {
        failures.push(`${o.key}: no SPECS entry`)
        continue
      }
      // fresh records per operation: some calls delete or consume them
      const f = await fixtureIds(t, a.tenant, a.owner, a.staff, dual)
      const w: World = { ...a, ...f }
      const params = Object.fromEntries(o.params.map((p) => [p, f.fixtures[o.path][p].value]))
      await spec.prepare?.(w)
      const ex = bodyExample(o.op)
      const body = ex.present ? await (spec.body ? spec.body(w) : ex.example) : undefined
      const r = await call(t.app, o.method, substitute(o.path, params), { cookie: spec.actor === "dual" ? dual.cookie : ownerA.cookie, tenant: a.tenant.slug, body })
      if (r.status === 404 || r.status >= 500) failures.push(`${o.key} -> ${r.status} with A's own ids: ${(await r.text()).slice(0, 120)}`)
    }
    expect(failures).toEqual([])
  }, 120_000)

  test("static-param routes (the explicit exclusions): A's call only ever touches A's rows", async () => {
    const put = (as: Actor, tenant: string, allow: string) => call(t.app, "PUT", "/v1/device-policies/drive", { cookie: as.cookie, tenant, body: { allow } })
    expect((await put(b.owner, b.tenant.slug, "none")).status).toBe(200)
    const before = await hashes(b.tenant.id)
    expect((await put(ownerA, a.tenant.slug, "any")).status).toBe(200)
    expect(await hashes(b.tenant.id)).toEqual(before)
    const rows = await ownerTenantQuery(b.tenant.id, "select allow from device_policies where feature = 'drive'")
    expect(rows.map((r) => r.allow)).toEqual(["none"])
    // and the X-Tenant header cannot be pointed at B by A's owner
    expect((await put(ownerA, b.tenant.slug, "any")).status).toBe(404)
  })

  test("a tenant-scoped GET never returns B's rows to A", async () => {
    for (const path of ["/v1/roles", "/v1/teams", "/v1/devices", "/v1/people", "/v1/audit"]) {
      const r = await call(t.app, "GET", path, { cookie: ownerA.cookie, tenant: a.tenant.slug })
      expect(r.status, path).toBe(200)
      const text = await r.text()
      for (const m of b.marks) expect(text.includes(m), `${path} leaks ${m}`).toBe(false)
    }
  })
})

describe("C7: API-key variant of the isolation walker", () => {
  const keyFor = async (w: World, slug: string) => {
    const r = await call(t.app, "POST", "/v1/api-keys", { cookie: w.owner.cookie, tenant: slug, body: { name: "walker", scopes: ["settings:write"] } })
    expect(r.status).toBe(201)
    return ((await r.json()) as Json).key as string
  }
  test("a key minted in A against B's resources: 404 with the same code as a never-existing id, B unchanged (header absent, header = A, header = B)", async () => {
    const keyA = await keyFor(a, a.tenant.slug)
    const before = await hashes(b.tenant.id)
    const ghost = NIL_UUID
    const cases: { m: string; p: (id: string) => string; id: string; body?: unknown; code: string }[] = [
      { m: "PATCH", p: (id) => `/v1/teams/${id}`, id: b.resources.team, body: { name: "pwned" }, code: "team_not_found" },
      { m: "DELETE", p: (id) => `/v1/teams/${id}`, id: b.resources.team, code: "team_not_found" },
      { m: "PUT", p: (id) => `/v1/teams/${id}/members`, id: b.resources.team, body: { userIds: [] }, code: "team_not_found" },
    ]
    for (const c of cases) {
      for (const hdr of [undefined, a.tenant.slug]) {
        const r = await call(t.app, c.m, c.p(c.id), { headers: { authorization: `Bearer ${keyA}` }, tenant: hdr, body: c.body })
        expect(r.status, `${c.m} ${c.p(c.id)} x-tenant=${hdr}`).toBe(404)
        expect(((await r.json()) as Json).code).toBe(c.code)
        const g = await call(t.app, c.m, c.p(ghost), { headers: { authorization: `Bearer ${keyA}` }, tenant: hdr, body: c.body })
        expect(g.status).toBe(404)
        expect(((await g.json()) as Json).code).toBe(c.code)
      }
      const viaB = await call(t.app, c.m, c.p(c.id), { headers: { authorization: `Bearer ${keyA}` }, tenant: b.tenant.slug, body: c.body })
      expect(viaB.status).toBe(404)
      expect(((await viaB.json()) as Json).code).toBe("not_found") // header names another tenant: the generic 404
    }
    expect(await hashes(b.tenant.id)).toEqual(before)
    // control: the same key reaches A's own team (so the 404s above come from the tenant boundary)
    const own = await call(t.app, "PATCH", `/v1/teams/${a.resources.team}`, { headers: { authorization: `Bearer ${keyA}` }, body: { name: "renamed by key" } })
    expect(own.status).toBe(200)
  })
})

describe("every /v1 route is registered through OpenAPI (no hidden routes)", () => {
  const EXCLUDED = (p: string) => p.startsWith("/api/auth") || p === "/healthz" || p === "/readyz" || p === "/v1/openapi.json" || p.startsWith("/v1/_probe/") || p.startsWith("/webhooks/billing/") // ruling C5: raw-body, signature-authenticated provider webhooks
  test("app.routes minus the documented exclusions equals the OpenAPI paths", () => {
    const app = t.app
    const registered = new Set<string>()
    for (const r of app.routes) {
      if (r.method === "ALL" || EXCLUDED(r.path)) continue
      registered.add(`${r.method} ${r.path.replace(/:(\w+)/g, "{$1}")}`)
    }
    const documented = new Set<string>()
    for (const [path, item] of Object.entries(doc.paths)) for (const m of METHODS) if (item[m]) documented.add(`${m.toUpperCase()} ${path}`)
    expect(registered.size).toBeGreaterThan(20)
    for (const k of ["GET /v1/platform/staff", "POST /v1/platform/staff", "PATCH /v1/platform/staff/{userId}", "GET /v1/platform/audit", "GET /v1/platform/audit/export", "GET /v1/platform/settings/email", "PUT /v1/platform/settings/email", "POST /v1/platform/settings/email/test", "GET /v1/platform/settings/storage", "PUT /v1/platform/settings/storage", "POST /v1/platform/settings/storage/test", "GET /v1/platform/settings/billing", "PUT /v1/platform/settings/billing", "GET /v1/billing/subscription", "GET /v1/billing/invoices", "POST /v1/billing/checkout", "POST /v1/billing/portal", "POST /v1/billing/cancel", "POST /v1/billing/resume", "PUT /v1/billing/seats", "POST /v1/platform/tenants/{tenantId}/support-grants", "DELETE /v1/platform/support-grants/{id}", "GET /v1/settings/support-grants", "DELETE /v1/settings/support-grants/{id}", "POST /v1/api-keys", "GET /v1/api-keys", "DELETE /v1/api-keys/{id}", "POST /v1/webhooks", "GET /v1/webhooks", "PATCH /v1/webhooks/{id}", "DELETE /v1/webhooks/{id}"]) {
      expect(registered.has(k), `${k} registered`).toBe(true)
      expect(documented.has(k), `${k} in OpenAPI`).toBe(true)
    }
    expect([...registered].filter((k) => !documented.has(k)).sort()).toEqual([])
    expect([...documented].filter((k) => !registered.has(k)).sort()).toEqual([])
  })
  test("the exclusions are real and nothing else under /v1 is hidden", () => {
    const paths = t.app.routes.filter((r) => r.method !== "ALL").map((r) => r.path)
    expect(paths.some((p) => p.startsWith("/v1/_probe/"))).toBe(true)
    expect(paths).toContain("/webhooks/billing/stripe")
    expect([...new Set(paths.filter((p) => !p.startsWith("/v1/") && !p.startsWith("/api/auth") && !["/healthz", "/readyz"].includes(p)))]).toEqual(["/webhooks/billing/stripe"]) // (the body-limit middleware lists the path again)
    expect(paths.filter((p) => p.startsWith("/v1/") && !p.startsWith("/v1/_probe/") && p !== "/v1/openapi.json").length).toBeGreaterThan(20)
  })
})

describe("RLS: own-row read policies cannot widen a tenant-scoped transaction", () => {
  test("with BOTH app.tenant_id=A and app.user_id=<member of A and B> set, memberships and roles show only A's rows", async () => {
    const dual = await makeMember(t.deps, a.tenant.id, "employee")
    await makeMember(t.deps, b.tenant.id, "employee", { email: dual.email }) // same user, second tenant
    const { mem, rol } = await t.deps.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${a.tenant.id}, true)`)
      await tx.execute(sql`select set_config('app.user_id', ${dual.userId}, true)`)
      return { mem: await tx.select({ tenantId: memberships.tenantId, userId: memberships.userId }).from(memberships), rol: await tx.select({ tenantId: roles.tenantId }).from(roles) }
    })
    expect(mem.some((m) => m.userId === dual.userId && m.tenantId === a.tenant.id)).toBe(true)
    expect(mem.filter((m) => m.tenantId !== a.tenant.id)).toEqual([])
    expect(rol.length).toBeGreaterThan(0)
    expect(rol.filter((r) => r.tenantId !== a.tenant.id)).toEqual([])
  })
})
