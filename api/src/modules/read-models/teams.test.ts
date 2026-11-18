import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { ownerTenantQuery } from "../../../test/db"
import { resetDb } from "../../../test/harness"
import { resetSubscribers } from "../../core/events"
import { registerFiles } from "../files"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { registerTasks } from "../tasks"
import { registerShiftReports } from "../shift-reports"
import { world, type Json, type W, type Who } from "../shift-reports/world"
import { resetReadModelCache } from "./cache"

// B8 Task 15: the dashboard's team filter and its assignee-team grouping (ruling S8: a task of team T = filed under T OR assigned to a member of T, the SAME rule as GET /v1/tasks?teamId=).
// The clock is 2026-10-26T12:00Z. The default task of the shift-report world is due 2026-10-25T02:00Z (overdue).

const NOW = "2026-10-26T12:00:00.000Z"

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
  registerFiles()
  registerSearchIndexers()
  registerTasks()
  registerShiftReports()
  resetReadModelCache()
})

const get = async (w: W, path: string, as: Who): Promise<Json> => {
  const r = await w.req("GET", path, as)
  expect(r.status, `${path} ${await r.clone().text()}`).toBe(200)
  return w.json(r)
}
const team = async (w: W, name: string, members: Who[]): Promise<string> => {
  const t = await w.json(await w.req("POST", "/v1/teams", w.owner, { name, kind: "department" }))
  expect((await w.req("PUT", `/v1/teams/${t.id}/members`, w.owner, { userIds: members.map((m) => m.userId) })).status).toBe(200)
  return t.id as string
}

/** Cleaning = staff; Kitchen = staff2; a task filed under Cleaning but done by staff2, and one by staff3 (in no team). */
async function scene() {
  const w = await world({ now: NOW })
  const cleaning = await team(w, "Cleaning", [w.staff])
  const kitchen = await team(w, "Kitchen", [w.staff2])
  await w.task(w.staff, { title: "By member" })
  await w.task(w.staff2, { title: "By filing", teamId: cleaning })
  await w.task(w.staff2, { title: "Kitchen own" })
  await w.task(w.staff3, { title: "Nobody's team" })
  return { w, cleaning, kitchen }
}

describe("dashboard teamId (B8 T15)", () => {
  test("GET /v1/dashboard and /dashboard/team-tasks with teamId count and list exactly the tasks the task list has for that team (filed under OR assigned to a member), people included", async () => {
    const { w, cleaning, kitchen } = await scene()
    const all = await get(w, "/v1/dashboard", w.owner)
    expect(all.summary.open).toBe(4)
    for (const [id, titles] of [[cleaning, ["By filing", "By member"]], [kitchen, ["By filing", "Kitchen own"]]] as const) {
      const d = await get(w, `/v1/dashboard?teamId=${id}`, w.owner)
      expect(d.summary.open, id).toBe(2)
      expect(d.summary.overdue, id).toBe(2)
      expect(d.progress.total, id).toBe(2)
      const listed = (await get(w, `/v1/tasks?teamId=${id}&status=open&limit=100`, w.owner)).items as Json[]
      expect(listed.map((i) => i.title).sort()).toEqual([...titles])
      const rows = (await get(w, `/v1/dashboard/team-tasks?teamId=${id}`, w.owner)).items as Json[]
      expect(rows.map((i) => i.title).sort()).toEqual([...titles]) // the same rows as the list
      expect(rows.every((i) => typeof i.assignee === "string" && i.assignee !== "")).toBe(true)
    }
    expect((await get(w, "/v1/dashboard", w.owner)).summary.open).toBe(4) // the unfiltered answer is not the filtered one (the cache is keyed by the filter)
    expect(((await get(w, "/v1/dashboard/team-tasks", w.owner)).items as Json[]).length).toBe(4)
  })

  test("the staff dashboard takes teamId too: my tasks narrowed to that team's", async () => {
    const { w, cleaning, kitchen } = await scene()
    expect((await get(w, "/v1/dashboard/staff", w.staff2)).myTasks.open).toBe(2)
    const c = await get(w, `/v1/dashboard/staff?teamId=${cleaning}`, w.staff2)
    expect(c.myTasks.open).toBe(1) // staff2's task filed under Cleaning
    expect((c.myTasks.items as Json[]).map((i) => i.title)).toEqual(["By filing"])
    expect((await get(w, `/v1/dashboard/staff?teamId=${kitchen}`, w.staff2)).myTasks.open).toBe(2)
  })

  test("a team outside the caller's scope answers empty with the same shape and status as a team with no tasks (200, never 404, no hint that it exists)", async () => {
    const { w, kitchen } = await scene()
    await w.manages(w.manager, w.staff)
    const empty = await team(w, "Empty", [])
    for (const path of ["/v1/dashboard", "/v1/dashboard/team-tasks", "/v1/dashboard/staff"]) {
      const hidden = await get(w, `${path}?teamId=${kitchen}`, w.manager) // Kitchen's people are not the manager's reports
      const none = await get(w, `${path}?teamId=${empty}`, w.manager)
      const unknown = await get(w, `${path}?teamId=${randomUUID()}`, w.manager)
      const strip = (j: Json) => JSON.parse(JSON.stringify(j)) as Json
      expect(strip(hidden), path).toEqual(strip(none))
      expect(strip(unknown), path).toEqual(strip(none))
    }
    const d = await get(w, `/v1/dashboard?teamId=${kitchen}`, w.manager)
    expect(d.summary.open).toBe(0)
    expect(d.teams).toEqual([])
    expect(JSON.stringify(d)).not.toContain("Kitchen")
    expect((await w.req("GET", "/v1/dashboard?teamId=nope", w.manager)).status).toBe(400)
  })

  test("a person in two teams appears under both in the grouped view and once in the totals", async () => {
    const w = await world({ now: NOW })
    const cleaning = await team(w, "Cleaning", [w.staff])
    const kitchen = await team(w, "Kitchen", [w.staff, w.staff2])
    await w.task(w.staff, { title: "Both teams" })
    await w.task(w.staff2, { title: "Kitchen only" })
    const d = await get(w, "/v1/dashboard", w.owner)
    expect(d.summary.open).toBe(2) // each task once
    expect(d.progress.total).toBe(2)
    const rows = Object.fromEntries((d.teams as Json[]).map((t) => [t.team, t]))
    expect(rows.Cleaning).toMatchObject({ teamId: cleaning, open: 1, overdue: 1, people: 1 })
    expect(rows.Kitchen).toMatchObject({ teamId: kitchen, open: 2, overdue: 2, people: 2 }) // staff is counted under Cleaning AND Kitchen
    expect(d.teams as Json[]).toHaveLength(2)
    // a task filed under a team counts for it even when nobody of the team is assigned
    await w.task(w.staff3, { title: "Filed only", teamId: cleaning })
    const e = await get(w, "/v1/dashboard", w.ops)
    expect(e.summary.open).toBe(3)
    const cl = (e.teams as Json[]).find((t) => t.team === "Cleaning")!
    expect(cl).toMatchObject({ open: 2, people: 1 })
    // the filter keeps only that team
    const f = await get(w, `/v1/dashboard?teamId=${cleaning}`, w.ops)
    expect((f.teams as Json[]).map((t) => t.team)).toEqual(["Cleaning"])
  })

  test("the grouped view only counts what the caller's scope allows (a team manager sees their own people's tasks, never the tenant's)", async () => {
    const w = await world({ now: NOW })
    await team(w, "Cleaning", [w.staff, w.staff2])
    await w.task(w.staff, { title: "Mine to see" })
    await w.task(w.staff2, { title: "Not my report" })
    await w.manages(w.manager, w.staff)
    const d = await get(w, "/v1/dashboard", w.manager)
    expect(d.teams).toEqual([expect.objectContaining({ team: "Cleaning", open: 1, people: 1 })])
  })
})

describe("AG4: the grouped view's cut is deterministic", () => {
  test("with more teams than the 200 cap the 200 kept are the 200 lowest team ids (an ORDER BY before the limit), never an arbitrary hash order", async () => {
    const w = await world({ now: NOW })
    const ids: string[] = []
    for (let i = 0; i < 204; i++) ids.push(randomUUID())
    await ownerTenantQuery(w.tenant.id, `insert into teams (id, tenant_id, name, kind) select u, $1, 'T' || row_number() over (), 'department' from unnest($2::uuid[]) u`, [w.tenant.id, ids])
    await ownerTenantQuery(w.tenant.id, `insert into team_members (tenant_id, team_id, user_id) select $1, u, $3 from unnest($2::uuid[]) u`, [w.tenant.id, ids, w.staff.userId])
    for (const id of ids) await w.task(w.staff, { title: `T ${id.slice(0, 8)}`, teamId: id })
    const d = await get(w, "/v1/dashboard", w.owner)
    const got = new Set((d.teams as Json[]).map((t) => t.teamId as string))
    expect(got.size).toBe(200)
    expect([...got].sort()).toEqual([...ids].sort().slice(0, 200))
  })
})

describe("Today hasVoice (B8 T15)", () => {
  const withFile = async (w: W, taskId: string, status: string) => {
    const id = randomUUID()
    await w.q("insert into files (id, tenant_id, owner_user_id, key, name, mime, size_bytes, status, signature, created_at) values ($1, $2, $3, $4, 'voice-note', 'audio/webm', 10, $5, $6, now())", [id, w.tenant.id, w.owner.userId, `t/${w.tenant.id}/${id}`, status, status === "infected" ? "Eicar-Test" : null])
    await w.q("update tasks set voice_file_id = $2, voice_meta = $3 where id = $1", [taskId, id, JSON.stringify({ durationSec: 30, mime: "audio/webm", recordedBy: w.owner.userId, recordedAt: NOW })])
    return id
  }

  test("true only for a task with a voice note the caller can play (a clean file on one of their own tasks); false without a note, and while it is pending, infected or deleted; the response carries no file id", async () => {
    const w = await world({ now: NOW })
    const plain = await w.task(w.staff, { title: "No note" })
    const clean = await w.task(w.staff, { title: "Clean note" })
    const pending = await w.task(w.staff, { title: "Pending note" })
    const infected = await w.task(w.staff, { title: "Infected note" })
    const deleted = await w.task(w.staff, { title: "Deleted note" })
    const ids = [await withFile(w, clean.id, "clean"), await withFile(w, pending.id, "pending"), await withFile(w, infected.id, "infected"), await withFile(w, deleted.id, "deleted")]
    const today = await get(w, "/v1/today", w.staff)
    const has = Object.fromEntries((today.order as Json[]).map((i) => [i.taskId, i.hasVoice]))
    expect(has).toEqual({ [plain.id]: false, [clean.id]: true, [pending.id]: false, [infected.id]: false, [deleted.id]: false })
    for (const i of today.order as Json[]) expect(typeof i.hasVoice).toBe("boolean")
    const text = JSON.stringify(today)
    for (const id of ids) expect(text).not.toContain(id) // never a voice file id
    expect(text).not.toContain("audio/webm")
  })

  test("another person's task with a note is not on my Today at all, so its voice cannot show; and the owner's Today of their own task works the same", async () => {
    const w = await world({ now: NOW })
    const theirs = await w.task(w.staff2, { title: "Not mine" })
    await withFile(w, theirs.id, "clean")
    const mine = await w.task(w.staff, { title: "Mine" })
    const today = await get(w, "/v1/today", w.staff)
    expect((today.order as Json[]).map((i) => [i.taskId, i.hasVoice])).toEqual([[mine.id, false]])
  })
})
