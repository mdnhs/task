import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/actions/rosters", () => ({ applyWeekTemplate: vi.fn(), checkWeek: vi.fn(), createWeek: vi.fn(), reloadRoster: vi.fn(), saveWeekTemplate: vi.fn(), addShifts: vi.fn(), deleteShift: vi.fn(), patchShift: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))

import { LID2, lockedAccess, payloadFixture } from "../fixtures"
import { skeletonPayload, skeletonTemplates, SKELETON_TODAY } from "../skeleton-data"
import { RostersSkeleton } from "./skeletons"
import { RostersView } from "./rosters-view"
import type { RosterPayload, WeekAccess } from "../types"

const TODAY = "2026-11-04T09:00:00"
const html = (payload: RosterPayload, query = {}) => renderToStaticMarkup(createElement(RostersView, { payload, query: { week: "2026-11-02", ...query }, today: TODAY }))
const count = (s: string, needle: string) => s.split(needle).length - 1
const office: WeekAccess = { level: "office", canEdit: true, locked: false, lockReason: null }

describe("the week view renders the API payload", () => {
  it("shows 7 day columns, each person with their own start and end (AC-RS-01, AC-RS-02)", () => {
    const m = html(payloadFixture())
    expect(count(m, 'class="ros-day"')).toBe(7)
    for (const t of ["Ann Byrne", "Ben Walsh", "Cara Doyle", "Open shift"]) expect(m).toContain(t)
    expect(m).toContain("08:00–16:00")
    expect(m).toContain("14:00–22:00") // Ben's own times, not Ann's
    expect(m).toContain("22:00–06:00")
    expect(m).toContain("Mon 2 Nov")
    expect(m).toContain("Sun 8 Nov")
  })

  it("highlights short days from the payload and shows the counts against target", () => {
    const m = html(payloadFixture())
    expect(m).toContain('data-short="true"')
    expect(m).toContain("−2") // Monday: 2 of 4
    expect(m).toContain("25 short") // the header sum: the API's day columns added up
  })

  it("controls are on only when the payload's access allows them (add, drag, check, manage locations)", () => {
    const edit = html(payloadFixture({ access: office }))
    expect(count(edit, "ros-add")).toBeGreaterThanOrEqual(7)
    expect(edit).toContain("dnd-card")
    expect(edit).toContain("Check rules")
    expect(edit).toContain("Manage locations")
    const sup = html(payloadFixture())
    expect(sup).not.toContain("Manage locations") // a supervisor has no locations admin
    expect(sup).toContain("dnd-card")
  })

  it("a locked week is read-only: no add, no drag, a lock, and no 'Check rules' (403 roster_locked flips it the same way)", () => {
    const m = html(payloadFixture({ status: "published", access: lockedAccess }))
    expect(m).not.toContain("ros-add")
    expect(m).not.toContain("dnd-card")
    expect(m).not.toContain("dnd-grip")
    expect(m).not.toContain("Check rules")
    expect(m).toContain("Published and locked: read-only")
    expect(m).toContain("Ann Byrne") // still readable
    const none = html(payloadFixture({ access: { level: null, canEdit: false, locked: false, lockReason: "forbidden" } }))
    expect(none).not.toContain("dnd-card")
    expect(none).not.toContain("ros-add")
  })

  it("each week's own access decides its day columns (one site editable, the other locked)", () => {
    const m = html(payloadFixture({ locations: [payloadFixture().locations[0]!.id, LID2], weekAccess: (id) => (id === LID2 ? lockedAccess : office) }), { location: "all" })
    const [coppers, docklands] = m.split('aria-label="Docklands"') as [string, string]
    expect(coppers).toContain("ros-add")
    expect(docklands).not.toContain("ros-add")
    expect(docklands).not.toContain("dnd-card")
  })

  it("a week that does not exist yet offers 'Start week' only when the payload says the caller may create it", () => {
    expect(html(payloadFixture(), { week: "2026-11-09" })).toContain("Start week")
    expect(html(payloadFixture({ access: { level: null, canEdit: false, locked: false, lockReason: "forbidden" } }), { week: "2026-11-09" })).not.toContain("Start week")
  })

  it("a supervisor with one location sees only that location: no switcher, no other name", () => {
    const m = html(payloadFixture())
    expect(m).toContain("Coppers")
    expect(m).not.toContain("Docklands")
    expect(m).not.toContain("All locations")
    const two = html(payloadFixture({ locations: [payloadFixture().locations[0]!.id, LID2] }), { location: "all" })
    expect(two).toContain("All locations")
    expect(two).toContain("Docklands")
  })
})

describe("skeleton: the loading view is the same view, masked, over the typical week", () => {
  // Layout parity by construction: the skeleton renders RostersView itself, so every block (page head, filter bar, block head, seven columns, cards) has the same classes in the same order.
  // The pixel measurement (3 px at 1568 and 390 for owner, supervisor and staff-home shells) is recorded in the commit message and the report; jsdom has no layout.
  const shape = (s: string) => s.replace(/>[^<]*</g, "><").replace(/ (aria-[a-z]+|id|for|href|title|style|data-[a-z-]+)="[^"]*"/g, "").replace(/<(\/?)(span|div) class="(sk-mask|sr-only)[^"]*"[^>]*>/g, "")
  it("has the same blocks, columns and cards as the loaded view of the same payload", () => {
    const live = renderToStaticMarkup(createElement(RostersView, { payload: skeletonPayload(), query: {}, today: SKELETON_TODAY, templates: skeletonTemplates() }))
    const sk = renderToStaticMarkup(createElement(RostersSkeleton))
    expect(count(sk, 'class="ros-day"')).toBe(7)
    expect(count(sk, "ros-scard")).toBe(count(live, "ros-scard"))
    expect(count(sk, "ros-scard")).toBe(17)
    for (const cls of ["ros-nav", "ros-block-head", "ros-board", "ros-card", "ros-add"]) expect(count(sk, cls), cls).toBe(count(live, cls))
    expect(shape(sk)).toContain(shape(live).slice(0, 400))
    expect(sk).toContain("Loading rosters")
  })
  it("draws only placeholders: no tenant text reaches a skeleton (no API, no session)", () => {
    const sk = renderToStaticMarkup(createElement(RostersSkeleton))
    expect(sk).not.toMatch(/Coppers|Ann Byrne/)
  })
})
