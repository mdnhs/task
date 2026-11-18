import { beforeEach, describe, expect, test } from "vitest"
import { resetDb } from "../../../test/harness"
import { world, code, type Json } from "./world"

beforeEach(resetDb)

const dept = (summaryRequired: boolean): Json[] => [
  { dept: "Night team", sections: [{ id: "summary", title: "Summary", enabled: true, fields: [{ id: "summary", label: "Shift summary", required: summaryRequired }] }] },
]
const TEMPLATE = "/v1/shift-reports/template"

describe("report template ETag and If-Match (B7 ruling S6)", () => {
  test("GET carries a strong quoted ETag; it is stable until the template changes", async () => {
    const w = await world()
    const a = (await w.req("GET", TEMPLATE, w.owner)).headers.get("etag")
    expect(a).toMatch(/^"[0-9a-f]{32}"$/)
    expect((await w.req("GET", TEMPLATE, w.staff)).headers.get("etag")).toBe(a) // the tag is the stored template's, not the caller's scoped view
    expect((await w.putTemplate(w.owner, dept(true), a)).status).toBe(200)
    expect((await w.req("GET", TEMPLATE, w.owner)).headers.get("etag")).not.toBe(a)
  })

  test("PUT without If-Match is 428 precondition_required and writes nothing", async () => {
    const w = await world()
    const r = await w.putTemplate(w.owner, dept(true), null)
    expect([r.status, await code(r)]).toEqual([428, "precondition_required"])
    expect((await w.q("select count(*)::int n from tenant_settings where key = 'report_template'"))[0].n).toBe(0)
  })

  test("PUT with a stale ETag is 412 precondition_failed and answers the current ETag; nothing is written", async () => {
    const w = await world()
    const first = (await w.req("GET", TEMPLATE, w.owner)).headers.get("etag")!
    expect((await w.putTemplate(w.owner, dept(true), first)).status).toBe(200)
    const now = (await w.req("GET", TEMPLATE, w.owner)).headers.get("etag")!
    const r = await w.putTemplate(w.owner, dept(false), first)
    expect([r.status, await code(r)]).toEqual([412, "precondition_failed"])
    expect(r.headers.get("etag")).toBe(now)
    expect((await w.q("select value from tenant_settings where key = 'report_template'"))[0].value.departments[0].sections[0].fields[0].required).toBe(true)
    // a weak tag, a wildcard, garbage and a list without the current tag never match
    for (const bad of [`W/${now}`, "*", "nonsense", `"zz", "yy"`]) expect((await w.putTemplate(w.owner, dept(false), bad)).status, bad).toBe(412)
  })

  test("PUT with the current ETag is 200, bumps the ETag and the response carries the new one; a list holding the current tag matches", async () => {
    const w = await world()
    const a = (await w.req("GET", TEMPLATE, w.owner)).headers.get("etag")!
    const r = await w.putTemplate(w.owner, dept(true), a)
    expect(r.status).toBe(200)
    const b = r.headers.get("etag")!
    expect(b).not.toBe(a)
    expect(b).toBe((await w.req("GET", TEMPLATE, w.owner)).headers.get("etag"))
    expect((await w.putTemplate(w.owner, dept(false), `"zz", ${b}`)).status).toBe(200)
  })

  test("a team rename (which rewrites the stored template) changes the ETag", async () => {
    const w = await world()
    expect((await w.putTemplate(w.owner, dept(true))).status).toBe(200)
    const before = (await w.req("GET", TEMPLATE, w.owner)).headers.get("etag")
    expect((await w.req("PATCH", `/v1/teams/${w.team}`, w.owner, { name: "Late team" })).status).toBe(200)
    expect((await w.req("GET", TEMPLATE, w.owner)).headers.get("etag")).not.toBe(before)
  })

  test("two concurrent PUTs with the same ETag: exactly one wins, one audit row, the loser is 412", async () => {
    const w = await world()
    const tag = (await w.req("GET", TEMPLATE, w.owner)).headers.get("etag")!
    const rs = await Promise.all([w.putTemplate(w.owner, dept(true), tag), w.putTemplate(w.owner, dept(false), tag)])
    expect(rs.map((r) => r.status).sort()).toEqual([200, 412])
    expect((await w.q("select count(*)::int n from audit_events where action = 'tenant.report_template_updated'"))[0].n).toBe(1)
  })

  test("a caller without settings:write is 403 whatever the header says (no ETag oracle)", async () => {
    const w = await world()
    expect((await w.putTemplate(w.staff, dept(true), null)).status).toBe(403)
    expect((await w.putTemplate(w.staff, dept(true), `"nope"`)).status).toBe(403)
  })
})
