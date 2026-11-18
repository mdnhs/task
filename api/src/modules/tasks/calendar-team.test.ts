import { randomUUID } from "node:crypto"
import { beforeEach, describe, expect, test } from "vitest"
import { resetDb } from "../../../test/harness"
import { resetSubscribers } from "../../core/events"
import { registerFiles } from "../files"
import { registerNotifications } from "../notifications"
import { registerSearchIndexers } from "../search"
import { registerShiftReports } from "../shift-reports"
import { world, type Json, type W, type Who } from "../shift-reports/world"
import { registerTasks } from "."

// B8 Task 16: GET /v1/tasks/calendar?teamId= (ruling S8, the same rule and the same scope as GET /v1/tasks?teamId=).

beforeEach(async () => {
  await resetDb()
  resetSubscribers()
  registerNotifications()
  registerFiles()
  registerSearchIndexers()
  registerTasks()
  registerShiftReports()
})

const RANGE = "from=2026-11-16&to=2026-11-29"
const cal = async (w: W, as: Who, qs = RANGE): Promise<Json> => {
  const r = await w.req("GET", `/v1/tasks/calendar?${qs}`, as)
  expect(r.status, await r.clone().text()).toBe(200)
  return w.json(r)
}
const titles = (c: Json): string[] => (c.days as Json[]).flatMap((d) => (d.tasks as Json[]).map((t) => t.title as string)).sort()

async function scene() {
  const w = await world({ now: "2026-11-16T09:00:00.000Z" })
  const mk = async (name: string, members: Who[]) => {
    const t = await w.json(await w.req("POST", "/v1/teams", w.owner, { name, kind: "department" }))
    expect((await w.req("PUT", `/v1/teams/${t.id}/members`, w.owner, { userIds: members.map((m) => m.userId) })).status).toBe(200)
    return t.id as string
  }
  const cleaning = await mk("Cleaning", [w.staff])
  const kitchen = await mk("Kitchen", [w.staff2])
  const due = (d: string) => ({ start: `${d}T08:00:00.000Z`, due: `${d}T15:00:00.000Z` })
  await w.task(w.staff, { title: "By member", ...due("2026-11-17") })
  await w.task(w.staff2, { title: "By filing", teamId: cleaning, ...due("2026-11-18") })
  await w.task(w.staff2, { title: "Kitchen own", ...due("2026-11-18") })
  await w.task(w.staff3, { title: "Nobody's team", ...due("2026-11-19") })
  await w.task(w.staff, { title: "Out of range", ...due("2026-12-20") })
  return { w, cleaning, kitchen }
}

describe("calendar teamId (B8 T16)", () => {
  test("returns only that team's tasks in the range (filed under it OR assigned to a member), the same ones GET /v1/tasks?teamId= lists; without teamId the answer is exactly what it was", async () => {
    const { w, cleaning, kitchen } = await scene()
    expect(titles(await cal(w, w.owner))).toEqual(["By filing", "By member", "Kitchen own", "Nobody's team"]) // no filter: unchanged, range respected
    expect(titles(await cal(w, w.owner, `${RANGE}&teamId=${cleaning}`))).toEqual(["By filing", "By member"])
    expect(titles(await cal(w, w.owner, `${RANGE}&teamId=${kitchen}`))).toEqual(["By filing", "Kitchen own"])
    const list = (await w.json(await w.req("GET", `/v1/tasks?teamId=${cleaning}&limit=100`, w.owner))).items as Json[]
    expect(list.map((t) => t.title).filter((t) => t !== "Out of range").sort()).toEqual(titles(await cal(w, w.owner, `${RANGE}&teamId=${cleaning}`)))
    const filtered = await cal(w, w.owner, `${RANGE}&teamId=${cleaning}`)
    expect((filtered.days as Json[]).map((d) => d.date)).toHaveLength(14) // the day grid is the range, filtered or not
    expect(filtered.truncated).toBe(false)
  })

  test("a team outside the caller's scope, an unknown team and a team with no tasks are the same empty answer (200, same shape); a bad id is 400", async () => {
    const { w, kitchen } = await scene()
    await w.manages(w.manager, w.staff)
    const empty = await w.json(await w.req("POST", "/v1/teams", w.owner, { name: "Empty", kind: "department" }))
    const strip = (c: Json) => JSON.stringify(c)
    const hidden = await cal(w, w.manager, `${RANGE}&teamId=${kitchen}`) // Kitchen's people are not the manager's reports
    expect(titles(hidden)).toEqual([])
    expect(strip(hidden)).toBe(strip(await cal(w, w.manager, `${RANGE}&teamId=${empty.id}`)))
    expect(strip(hidden)).toBe(strip(await cal(w, w.manager, `${RANGE}&teamId=${randomUUID()}`)))
    expect((await w.req("GET", `/v1/tasks/calendar?${RANGE}&teamId=nope`, w.manager)).status).toBe(400)
  })
})
