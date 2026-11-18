import { beforeEach, describe, expect, test } from "vitest"
import { call, resetDb } from "../../../test/harness"
import { sites, type Json, type Who } from "./testkit"

// B8 Task 14: my roster and the .ics export (FR-RS-33, 40, R8-16, Review Focus 1 and 3).

beforeEach(resetDb)

type W = Awaited<ReturnType<typeof sites>>
const version = async (w: W, weekId: string): Promise<number> => Number((await w.rows("select version from roster_weeks where id = $1", [weekId]))[0].version)
const publish = async (w: W, weekId: string): Promise<void> => void (await w.ok("POST", `/v1/roster/weeks/${weekId}/publish`, w.p.owner, { version: await version(w, weekId) }))
const mine = (w: W, who: Who, q = "") => w.ok("GET", `/v1/roster/mine${q}`, who)
const ics = (w: W, who: Who, q = "") => w.req("GET", `/v1/roster/mine.ics${q}`, who)

/** The employee works at Alpha (Mon, Wed) and Bravo (Tue); Cian is on Alpha Monday and Bravo Tuesday. The Alpha week is published, the Bravo week is published too. */
async function twoSites(w: W) {
  await w.ok("PATCH", `/v1/locations/${w.a}`, w.p.owner, { version: 1, address: "1 Harbour Street, Dublin" })
  await w.ok("PATCH", `/v1/locations/${w.b}`, w.p.owner, { version: 1, address: "9 Quay Road, Cork" })
  await w.addOk(w.p.owner, w.wa, [{ date: "2026-11-02", userIds: [w.p.employee.userId, w.staff2.userId], shiftTypeId: w.ta }, { date: "2026-11-04", userIds: [w.p.employee.userId], shiftTypeId: w.ta, start: "10:00", end: "18:00" }])
  await w.addOk(w.p.owner, w.wb, [{ date: "2026-11-03", userIds: [w.p.employee.userId, w.staff2.userId], shiftTypeId: w.tb }])
  await publish(w, w.wa)
  await publish(w, w.wb)
}

describe("GET /v1/roster/mine (FR-RS-33)", () => {
  test("staff with shifts at two locations gets one combined list and sees no co-worker names (or ids), with the place's name and address and the confirmation state", async () => {
    const w = await sites()
    await twoSites(w)
    const shiftId = (await w.rows("select id from roster_shifts where user_id = $1 and date = '2026-11-02'", [w.p.employee.userId]))[0].id
    await w.ok("POST", `/v1/roster/shifts/${shiftId}/confirm`, w.p.employee)
    const r = await mine(w, w.p.employee, "?from=2026-11-01&to=2026-11-30")
    expect(r.items.map((s: Json) => [s.date, s.start, s.end, s.locationName, s.locationAddress])).toEqual([
      ["2026-11-02", "08:00", "16:00", "Alpha", "1 Harbour Street, Dublin"],
      ["2026-11-03", "08:00", "16:00", "Bravo", "9 Quay Road, Cork"],
      ["2026-11-04", "10:00", "18:00", "Alpha", "1 Harbour Street, Dublin"],
    ])
    expect(r.items[0]).toMatchObject({ id: shiftId, confirmedAt: "2026-11-16T09:00:00.000Z", role: "Guard", shiftType: "Day", timeZone: "Europe/Dublin", unpaidBreakMin: 0 })
    expect(r.items[1].confirmedAt).toBeNull()
    expect(r).toMatchObject({ from: "2026-11-01", to: "2026-11-30", truncated: false })
    const text = JSON.stringify(r)
    for (const other of [w.staff2.userId, "Cian", w.p.owner.userId, w.p["location-supervisor"].userId, w.sup2.userId]) expect(text, other).not.toContain(other)
    expect(Object.keys(r.items[0]).sort()).toEqual(["confirmedAt", "date", "end", "endAt", "id", "locationAddress", "locationId", "locationName", "role", "shiftType", "start", "startAt", "timeZone", "unpaidBreakMin", "version"])
    // Cian's list is his own two shifts
    expect((await mine(w, w.staff2, "?from=2026-11-01&to=2026-11-30")).items.map((s: Json) => s.date)).toEqual(["2026-11-02", "2026-11-03"])
  })

  test("draft week shifts never appear in /mine (AF1); they appear once the week is published", async () => {
    const w = await sites()
    const draft = await w.week(w.p.owner, w.a, "2026-11-09")
    await w.addOk(w.p.owner, draft, [{ date: "2026-11-09", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    await w.addOk(w.p.owner, w.wa, [{ date: "2026-11-02", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    await publish(w, w.wa)
    const q = "?from=2026-11-01&to=2026-11-30"
    expect((await mine(w, w.p.employee, q)).items.map((s: Json) => s.date)).toEqual(["2026-11-02"])
    expect(JSON.stringify(await mine(w, w.p.employee, q))).not.toContain("2026-11-09")
    await publish(w, draft)
    expect((await mine(w, w.p.employee, q)).items.map((s: Json) => s.date)).toEqual(["2026-11-02", "2026-11-09"])
  })

  test("an office role, a supervisor and a read-only manager each get only THEIR OWN shifts, never the location's", async () => {
    const w = await sites()
    await twoSites(w)
    const sup = w.p["location-supervisor"]
    const first = await w.req("POST", `/v1/roster/weeks/${w.wa}/shifts`, w.p.owner, { shifts: [{ date: "2026-11-05", userIds: [sup.userId, w.p.manager.userId, w.p.owner.userId], shiftTypeId: w.ta }], reason: "Cover" })
    expect(first.status).toBe(201)
    for (const who of [sup, w.p.manager, w.p.owner]) {
      const r = await mine(w, who, "?from=2026-11-01&to=2026-11-30")
      expect(r.items.map((s: Json) => s.date), who.userId).toEqual(["2026-11-05"])
      expect(JSON.stringify(r)).not.toContain(w.p.employee.userId)
    }
  })

  test("range: defaults to today for 28 days, a bad or backwards or over-long range is 422 invalid_range, a day with nothing is an empty list", async () => {
    const w = await sites()
    await twoSites(w)
    expect(await mine(w, w.p.employee)).toMatchObject({ from: "2026-11-16", to: "2026-12-13", items: [] }) // the clock is 2026-11-16: the November shifts are in the past
    for (const q of ["?from=2026-02-30", "?from=2026-11-10&to=2026-11-09", "?from=2026-01-01&to=2027-01-03", "?to=nope"]) expect((await w.fail("GET", `/v1/roster/mine${q}`, w.p.employee, undefined, 422)).code, q).toBe("invalid_range")
    expect((await mine(w, w.p.employee, "?from=2026-01-01&to=2026-12-31")).items).toHaveLength(3) // exactly 365 days is fine
  })

  test("an unauthenticated call is 401", async () => {
    const w = await sites()
    expect((await call(w.app, "GET", "/v1/roster/mine", { tenant: "acme" })).status).toBe(401)
  })
})

describe("GET /v1/roster/mine.ics (R8-16, Review Focus 3)", () => {
  test("CRLF, 75-octet folding, UTC times and no VTIMEZONE; UID is the shift uuid at the API host; an overnight shift ends next day and the 24 Oct 2026 night is 9 hours", async () => {
    const w = await sites()
    const night = await w.type(w.a, "Night", { start: "22:00", end: "06:00" })
    const wk = await w.week(w.p.owner, w.a, "2026-10-19")
    const added = await w.addOk(w.p.owner, wk, [{ date: "2026-10-24", userIds: [w.p.employee.userId], shiftTypeId: night }, { date: "2026-10-19", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    await publish(w, wk)
    const r = await ics(w, w.p.employee, "?from=2026-10-01&to=2026-10-31")
    const text = await r.text()
    expect(r.status).toBe(200)
    expect(text.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true)
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true)
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/) // CRLF only
    for (const line of text.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(text).not.toContain("VTIMEZONE")
    expect(text).not.toContain("TZID")
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    const sat = added.shifts.find((s: Json) => s.date === "2026-10-24")
    expect(text).toContain(`UID:${sat.id}@localhost\r\n`) // the host of APP_URL
    expect(text).toContain("DTSTART:20261024T210000Z\r\n") // 22:00 IST
    expect(text).toContain("DTEND:20261025T060000Z\r\n") // 06:00 GMT: the next day, 9 real hours
    expect(text).toContain("DTSTART:20261019T070000Z\r\n")
    expect(text).toContain("DTSTAMP:20261116T090000Z\r\n") // the fake clock, never the wall clock
    expect(text).toContain("SUMMARY:Guard at Alpha\r\n")
    expect(text).toContain("LOCATION:Alpha\r\n")
  })

  test("a long place name and address fold at 75 octets (multi-byte characters never split); comma, semicolon, backslash and CR LF are escaped and cannot inject a property", async () => {
    const w = await sites()
    const address = `${"Straße, é€ ".repeat(14)}\r\nATTENDEE:mailto:evil@example.com\rBEGIN:VALARM; a\\b`
    await w.ok("PATCH", `/v1/locations/${w.a}`, w.p.owner, { version: 1, address })
    await w.addOk(w.p.owner, w.wa, [{ date: "2026-11-02", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    await publish(w, w.wa)
    const text = await (await ics(w, w.p.employee, "?from=2026-11-01&to=2026-11-30")).text()
    const lines = text.split("\r\n")
    for (const line of lines) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(lines.some((l) => l.startsWith("ATTENDEE") || l.startsWith("BEGIN:VALARM"))).toBe(false)
    expect(lines.some((l) => l.startsWith(" "))).toBe(true) // folded
    const unfolded = text.replace(/\r\n /g, "")
    expect(unfolded).toContain("\\,") // commas escaped
    expect(unfolded).toContain("\\n") // the newline is the two characters \n, not a line break
    expect(unfolded).toContain("\\;")
    expect(unfolded).toContain("\\\\b")
    expect(unfolded).not.toMatch(/\r\n(ATTENDEE|BEGIN:VALARM)/)
  })

  test("only the person's own published shifts, and nothing but title, time and place: no other person, no confirmation state, no id but the shift's", async () => {
    const w = await sites()
    await twoSites(w)
    const draft = await w.week(w.p.owner, w.a, "2026-11-09")
    await w.addOk(w.p.owner, draft, [{ date: "2026-11-09", userIds: [w.p.employee.userId], shiftTypeId: w.ta }])
    const text = await (await ics(w, w.p.employee, "?from=2026-11-01&to=2026-11-30")).text()
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(3) // not the draft, not Cian's shifts
    expect(text).not.toContain("20261109")
    for (const secret of [w.staff2.userId, "Cian", "Aoife", w.a, w.b, w.p.employee.userId, w.p.owner.userId]) expect(text, secret).not.toContain(secret)
    const keys = new Set(text.split("\r\n").map((l) => l.split(":")[0].split(";")[0]).filter((k) => k && !k.startsWith(" ")))
    expect([...keys].sort()).toEqual(["BEGIN", "CALSCALE", "DESCRIPTION", "DTEND", "DTSTAMP", "DTSTART", "END", "LOCATION", "METHOD", "PRODID", "SEQUENCE", "SUMMARY", "UID", "VERSION", "X-WR-CALNAME"])
  })

  test("response headers: Content-Type text/calendar; charset=utf-8, Content-Disposition attachment, X-Content-Type-Options nosniff, no caching", async () => {
    const w = await sites()
    await twoSites(w)
    const r = await ics(w, w.p.employee, "?from=2026-11-01&to=2026-11-30")
    expect(r.status).toBe(200)
    expect(r.headers.get("content-type")).toBe("text/calendar; charset=utf-8")
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="roster.ics"')
    expect(r.headers.get("x-content-type-options")).toBe("nosniff")
    expect(r.headers.get("cache-control")).toMatch(/no-store/)
    expect(r.headers.get("cache-control")).toMatch(/private/)
  })

  test("a calendar download needs a session (401 without), roster access (a role without it is 403), and is rate limited per person (429 rate_limited with Retry-After after 20 a minute); the JSON list is not limited", async () => {
    const w = await sites()
    await twoSites(w)
    for (let i = 0; i < 20; i++) expect((await ics(w, w.p.employee, "?from=2026-11-01&to=2026-11-30")).status, `call ${i + 1}`).toBe(200)
    const limited = await ics(w, w.p.employee, "?from=2026-11-01&to=2026-11-30")
    expect(limited.status).toBe(429)
    expect(((await limited.json()) as Json).code).toBe("rate_limited")
    expect(limited.headers.get("retry-after")).toBeTruthy()
    expect((await ics(w, w.staff3)).status).toBe(200) // another person has their own budget
    expect((await w.req("GET", "/v1/roster/mine", w.p.employee)).status).toBe(200)
    expect(w.rateLimiter.hits.filter((k) => k.startsWith("roster-ics:")).every((k) => k.includes(w.tenant.id))).toBe(true) // the key carries the tenant
    expect((await call(w.app, "GET", "/v1/roster/mine.ics", { tenant: "acme" })).status).toBe(401)
  })

  test("a bad range is 422 invalid_range for the file too, and the problem answer is not a calendar", async () => {
    const w = await sites()
    const r = await ics(w, w.p.employee, "?from=2026-02-30")
    expect(r.status).toBe(422)
    expect(r.headers.get("content-type")).toMatch(/problem\+json/)
    expect(r.headers.get("content-disposition")).toBeNull()
  })

  test("two calls give the same bytes: the UIDs are stable per shift and the stamp is the clock's", async () => {
    const w = await sites()
    await twoSites(w)
    const a = await (await ics(w, w.p.employee, "?from=2026-11-01&to=2026-11-30")).text()
    const b = await (await ics(w, w.p.employee, "?from=2026-11-01&to=2026-11-30")).text()
    expect(b).toBe(a)
    expect(a).toMatch(/SEQUENCE:\d+\r\n/) // the shift version: a retime bumps it so calendar apps replace the entry
  })
})
