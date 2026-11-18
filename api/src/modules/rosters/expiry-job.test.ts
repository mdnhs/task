import { readFileSync } from "node:fs"
import { beforeEach, describe, expect, test } from "vitest"
import { ownerQuery } from "../../../test/db"
import { fakeClock, resetDb } from "../../../test/harness"
import { runJob } from "../../core/queue/queue"
import type { Deps } from "../../deps"
import { QUALIFICATION_EXPIRY_JOB, registerRosters, runQualificationExpiryJob } from "./jobs"
import { sites, type Json, type Who } from "./testkit"

// B8 Task 14: the qualification-expiry sweep (FR-RS-40): the person and the office are told at the lead days, exactly once per (person, qualification, expiry date, lead).

beforeEach(resetDb)

type W = Awaited<ReturnType<typeof world>>
const world = (now = "2026-11-16T09:00:00.000Z") => sites({ clock: fakeClock(new Date(now)) })
const setClock = (w: W, at: string) => {
  const d = Date.parse(at) - w.clock.now().getTime()
  if (d < 0) throw new Error("the clock cannot go back")
  w.clock.advance({ minutes: d / 60_000 })
}
const qual = (w: W, who: Who, type: string, expiresOn: string | null) => w.ok("PUT", `/v1/members/${who.userId}/qualifications`, w.p.owner, { qualifications: [{ type, expiresOn }] })
const run = (w: W, data: unknown = {}, workers = 1, deps: Deps = w.deps) => Promise.all(Array.from({ length: workers }, () => runQualificationExpiryJob(data, deps)))
const ledger = (w: W) => w.rows("select user_id, type, expires_on::text as expires_on, lead_days, created_at from qualification_expiry_notices order by expires_on, lead_days, user_id")
const notes = (w: W, title = "Qualification expiring") => w.rows("select user_id, title, body, kind, subject_user_id, created_at from notifications where title = $1 order by user_id, id", [title])
const OFFICE = (w: W) => [w.p.owner.userId, w.p.admin.userId, w.p["roster-manager"].userId].sort()
const spy = () => {
  const lines: Json[] = []
  const mk = (level: string) => (o: unknown, m?: string) => void lines.push({ level, ...(o && typeof o === "object" ? (o as Json) : {}), msg: m ?? (typeof o === "string" ? o : undefined) })
  const l = { error: mk("error"), warn: mk("warn"), info: mk("info"), debug: mk("debug"), trace: mk("trace"), fatal: mk("fatal"), level: "debug" } as Json
  l.child = () => l
  return { logger: l as unknown as Deps["logger"], lines }
}

describe("qualification expiry sweep (FR-RS-40)", () => {
  test("a licence expiring in 7 days notifies the person and the office once; a second run and three concurrent runs send nothing more (ledger)", async () => {
    const w = await world()
    await qual(w, w.p.employee, "first aid", "2026-11-23")
    await run(w)
    const n = await notes(w)
    expect(n.map((x) => x.user_id).sort()).toEqual([w.p.employee.userId, ...OFFICE(w)].sort())
    const own = n.find((x) => x.user_id === w.p.employee.userId)!
    expect(own.body).toBe("Your first aid expires on 2026-11-23. Please renew it.")
    expect(own.subject_user_id).toBeNull()
    for (const x of n.filter((y) => y.user_id !== w.p.employee.userId)) {
      expect(x.body).toBe("{{subject}}: first aid expires on 2026-11-23") // the name is rendered when it is read, never stored
      expect(x.subject_user_id).toBe(w.p.employee.userId)
      expect(x.kind).toBe("member")
    }
    expect(JSON.stringify(n)).not.toContain("Aoife")
    expect(await ledger(w)).toEqual([expect.objectContaining({ user_id: w.p.employee.userId, type: "first aid", expires_on: "2026-11-23", lead_days: 7 })])
    await run(w)
    await run(w, {}, 3)
    expect(await notes(w)).toHaveLength(4)
    expect(await ledger(w)).toHaveLength(1)
  })

  test("a licence that expired yesterday is reported once (lead 0) as expired; later runs say nothing; one that expired long ago is not reported at all", async () => {
    const w = await world()
    await qual(w, w.p.employee, "first aid", "2026-11-15")
    await qual(w, w.staff2, "sia licence", "2026-08-01")
    await run(w)
    const n = await notes(w, "Qualification expired")
    expect(n.map((x) => x.user_id).sort()).toEqual([w.p.employee.userId, ...OFFICE(w)].sort())
    expect(n.find((x) => x.user_id === w.p.employee.userId)!.body).toBe("Your first aid expired on 2026-11-15. Please renew it.")
    expect(n.find((x) => x.user_id === w.p.owner.userId)!.body).toBe("{{subject}}: first aid expired on 2026-11-15")
    expect(await ledger(w)).toEqual([expect.objectContaining({ user_id: w.p.employee.userId, expires_on: "2026-11-15", lead_days: 0 })])
    setClock(w, "2026-11-20T09:00:00.000Z")
    await run(w, {}, 2)
    expect(await notes(w, "Qualification expired")).toHaveLength(4)
    expect(await notes(w)).toHaveLength(0)
  })

  test("as the date comes closer the next lead day is sent once each (30, 14, 7, 1 days, then expired); a run that skipped days sends only the CURRENT lead, not the backlog", async () => {
    const w = await world()
    await qual(w, w.p.employee, "first aid", "2026-12-10") // 24 days away
    const personNotes = async () => (await w.rows("select title, created_at from notifications where user_id = $1 and title like 'Qualification%' order by created_at, id", [w.p.employee.userId])).map((x) => x.title)
    await run(w)
    expect((await ledger(w)).map((l) => l.lead_days)).toEqual([30])
    setClock(w, "2026-11-25T09:00:00.000Z") // 15 days: still the 30 bucket (no new notice)
    await run(w)
    expect((await ledger(w)).map((l) => l.lead_days)).toEqual([30])
    setClock(w, "2026-11-27T09:00:00.000Z") // 13 days: 14
    await run(w)
    setClock(w, "2026-12-09T09:00:00.000Z") // 1 day: the run skipped the 7 bucket: only the current one is sent
    await run(w)
    setClock(w, "2026-12-10T09:00:00.000Z") // the expiry day itself: still valid, still the 1 bucket
    await run(w)
    setClock(w, "2026-12-11T09:00:00.000Z") // expired
    await run(w)
    await run(w, {}, 2)
    expect((await ledger(w)).map((l) => l.lead_days)).toEqual([0, 1, 14, 30])
    expect(await personNotes()).toEqual(["Qualification expiring", "Qualification expiring", "Qualification expiring", "Qualification expired"])
  })

  test("an office person whose OWN licence expires is told once (their own wording), not also as the office", async () => {
    const w = await world()
    await qual(w, w.p.owner, "first aid", "2026-11-23")
    await run(w)
    const mine = (await notes(w)).filter((x) => x.user_id === w.p.owner.userId)
    expect(mine.map((x) => x.body)).toEqual(["Your first aid expires on 2026-11-23. Please renew it."])
    expect((await notes(w)).filter((x) => x.user_id === w.p.admin.userId).map((x) => x.body)).toEqual(["{{subject}}: first aid expires on 2026-11-23"])
  })

  test("the lead is the same in SQL and in expiryLead for every distance from 9 days past to 35 days ahead (30, 14, 7, 1; 0 for expired within a week; nothing outside)", async () => {
    const w = await world()
    const people = [w.p.employee, w.staff2, w.staff3, w.p.manager, w.p.admin]
    const offsets = Array.from({ length: 45 }, (_, i) => i - 9)
    const day = (d: number) => new Date(Date.UTC(2026, 10, 16 + d)).toISOString().slice(0, 10)
    // one qualification per offset (types differ), spread over five people (a person holds many types)
    await w.rows(
      `insert into member_qualifications (tenant_id, user_id, type, expires_on, created_at, updated_at) select $1, ($2::text[])[1 + (g % 5)], 'type-' || g, ($3::date + (g - 9)), now(), now() from generate_series(0, 44) g`,
      [w.tenant.id, people.map((p) => p.userId), "2026-11-16"],
    )
    await run(w, { batch: 200 })
    const got = new Map((await ledger(w)).map((l) => [l.type, l.lead_days]))
    const { expiryLead } = await import("./jobs")
    for (const off of offsets) {
      const want = expiryLead(off)
      expect(got.get(`type-${off + 9}`) ?? null, `${day(off)} (${off} days)`).toBe(want)
    }
    expect(expiryLead(-8)).toBeNull()
    expect(expiryLead(-1)).toBe(0)
    expect([0, 1, 2, 7, 8, 14, 15, 30, 31].map(expiryLead)).toEqual([1, 1, 7, 7, 14, 14, 30, 30, null])
  })

  test("renewing the licence (a later expiry date) starts a new cycle; the old date is not notified again", async () => {
    const w = await world()
    await qual(w, w.p.employee, "first aid", "2026-11-23")
    await run(w)
    await qual(w, w.p.employee, "first aid", "2027-11-23")
    await run(w)
    expect(await ledger(w)).toHaveLength(1)
    setClock(w, "2027-11-17T09:00:00.000Z") // a year on: the new date is 6 days away
    await run(w)
    expect((await ledger(w)).map((l) => [l.expires_on, l.lead_days])).toEqual([["2026-11-23", 7], ["2027-11-23", 7]])
  })

  test("only ACTIVE members are told: a deactivated office person gets nothing, and a deactivated person's own licence is not reported (nor entered in the ledger)", async () => {
    const w = await world()
    await qual(w, w.p.employee, "first aid", "2026-11-23")
    await qual(w, w.staff2, "sia licence", "2026-11-23")
    await w.rows("update memberships set status = 'deactivated', deactivated_at = now() where tenant_id = $1 and user_id in ($2, $3)", [w.tenant.id, w.p.admin.userId, w.staff2.userId])
    await run(w)
    const n = await notes(w)
    expect(n.map((x) => x.user_id).sort()).toEqual([w.p.employee.userId, w.p.owner.userId, w.p["roster-manager"].userId].sort())
    expect((await ledger(w)).map((l) => l.user_id)).toEqual([w.p.employee.userId])
  })

  test("the office audience follows the person's home site: a Roster Manager excepted from it is not told, a person homed nowhere is every office role's concern", async () => {
    const w = await world()
    await w.ok("PUT", `/v1/roster/office-limits/${w.p["roster-manager"].userId}`, w.p.owner, { except: [w.b] })
    await w.ok("PUT", `/v1/members/${w.staff3.userId}/home-location`, w.p.owner, { locationId: w.b })
    await qual(w, w.staff3, "first aid", "2026-11-23") // homed at Bravo
    await qual(w, w.p.employee, "first aid", "2026-11-23") // homed nowhere
    await run(w)
    const forStaff3 = (await notes(w)).filter((x) => x.subject_user_id === w.staff3.userId).map((x) => x.user_id).sort()
    expect(forStaff3).toEqual([w.p.admin.userId, w.p.owner.userId].sort()) // the office roles that cover Bravo: not the Roster Manager cut from it
    expect((await notes(w)).some((x) => x.user_id === w.staff3.userId && x.subject_user_id === null)).toBe(true) // the person's own notice
    const forEmployee = (await notes(w)).filter((x) => x.subject_user_id === w.p.employee.userId).map((x) => x.user_id).sort()
    expect(forEmployee).toEqual(OFFICE(w))
  })

  test("it uses deps.clock: before the 30-day window nothing is sent, on the first day of it the first notice goes; the ledger and notification times are the fake clock's", async () => {
    const w = await world("2026-11-16T09:00:00.000Z")
    await qual(w, w.p.employee, "first aid", "2027-01-01") // 46 days away
    await run(w)
    expect(await ledger(w)).toEqual([])
    setClock(w, "2026-12-02T09:00:00.000Z") // 30 days
    await run(w)
    const l = await ledger(w)
    expect(l).toHaveLength(1)
    expect(l[0].created_at.toISOString()).toBe("2026-12-02T09:00:00.000Z")
    expect((await notes(w)).every((x) => x.created_at.toISOString() === "2026-12-02T09:00:00.000Z")).toBe(true)
  })

  test("a tenant without the roster module is skipped; the sweep never touches a licence without an expiry date", async () => {
    const w = await world()
    await qual(w, w.p.employee, "first aid", "2026-11-23")
    await qual(w, w.staff2, "driving licence", null)
    await w.rows("insert into module_overrides (tenant_id, module, mode, reason, set_by, set_at) values ($1, 'M1A', 'revoke', 'test', 'p', now())", [w.tenant.id])
    await run(w)
    expect(await ledger(w)).toEqual([])
    await w.rows("delete from module_overrides where tenant_id = $1", [w.tenant.id])
    await run(w)
    expect((await ledger(w)).map((l) => l.user_id)).toEqual([w.p.employee.userId])
  })

  test("bounded batches: `batch` qualifications per tenant per run, soonest first, the rest on the next run", async () => {
    const w = await world()
    await qual(w, w.p.employee, "first aid", "2026-11-25")
    await qual(w, w.staff2, "first aid", "2026-11-23")
    await qual(w, w.staff3, "first aid", "2026-11-24")
    await run(w, { batch: 1 })
    expect((await ledger(w)).map((l) => l.user_id)).toEqual([w.staff2.userId])
    await run(w, { batch: 1 })
    expect((await ledger(w)).map((l) => l.user_id).sort()).toEqual([w.staff2.userId, w.staff3.userId].sort())
    await run(w, { batch: 1 })
    expect(await ledger(w)).toHaveLength(3)
    await run(w, { batch: 1 })
    expect(await ledger(w)).toHaveLength(3)
  })

  test("a failure is logged with the tenant id and a safe code only (no names, no SQL), leaves no ledger row or notice, and the next run sends them", async () => {
    const w = await world()
    await qual(w, w.p.employee, "first aid", "2026-11-23")
    await ownerQuery(`create function fail_notice() returns trigger language plpgsql as $$ begin raise exception 'Aoife Byrne secret'; end $$`)
    await ownerQuery("create trigger fail_notice before insert on notifications for each row execute function fail_notice()")
    const s = spy()
    try {
      await run(w, {}, 1, { ...w.deps, logger: s.logger })
    } finally {
      await ownerQuery("drop trigger fail_notice on notifications")
      await ownerQuery("drop function fail_notice()")
    }
    expect(await ledger(w)).toEqual([])
    expect(await notes(w)).toEqual([])
    const errors = s.lines.filter((l) => l.level === "error")
    expect(errors).toHaveLength(1)
    expect(Object.keys(errors[0]).sort()).toEqual(["errCode", "level", "msg", "tenantId"])
    expect(JSON.stringify(s.lines)).not.toMatch(/Aoife|secret|insert into/i)
    await run(w)
    expect(await ledger(w)).toHaveLength(1)
  })

  test("the job is registered (roster.qualification-expiry), scheduled hourly by the worker, takes the roster lock first, and never reads the wall clock", async () => {
    const w = await world()
    await qual(w, w.p.employee, "first aid", "2026-11-23")
    registerRosters()
    await runJob(QUALIFICATION_EXPIRY_JOB, {}, w.deps)
    expect(await ledger(w)).toHaveLength(1)
    expect(QUALIFICATION_EXPIRY_JOB).toBe("roster.qualification-expiry")
    const src = readFileSync(new URL("./jobs.ts", import.meta.url), "utf8")
    expect(src).not.toMatch(/new Date\(\)|Date\.now\(/)
    expect(src).not.toMatch(/(^|[^.\w])now\(\)/m)
    expect(src.slice(src.indexOf("async function noticesOne"))).toMatch(/lockRoster\(tx, tenantId\)/)
    const worker = readFileSync(new URL("../../worker.ts", import.meta.url), "utf8")
    expect(worker).toMatch(/upsertJobScheduler\(QUALIFICATION_EXPIRY_JOB, \{ every: 60 \* 60_000 \}/)
  })
})
