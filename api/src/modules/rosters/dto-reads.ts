import { z } from "@hono/zod-openapi"
import { AccessOut } from "./dto"

// DTOs of the roster read models (B8 Task 14): my roster, the `.ics` feed's query, coverage, and the roster attention items.

const LID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
const WEEK_ID = "5d8b2f4a-1c3e-4a7b-8f60-9e2d1c0b3a44"
const SHIFT_ID = "9a1c6b3e-2d4f-4e58-b7a9-1f3c5d7e9b02"

// ------------------------------------------------------------------ my roster (FR-RS-33, 40)

export const MineQuery = z.object({
  from: z.string().max(10).optional().openapi({ description: "First date YYYY-MM-DD (default: today in the tenant zone)", example: "2026-11-16" }),
  to: z.string().max(10).optional().openapi({ description: "Last date, inclusive (default: 27 days after `from`; at most 366 days after it)", example: "2026-12-13" }),
})
const MineShift = z.object({
  id: z.uuid(), date: z.string(), start: z.string(), end: z.string(), startAt: z.string(), endAt: z.string(), unpaidBreakMin: z.number().int(), role: z.string(), shiftType: z.string(),
  confirmedAt: z.string().nullable(), version: z.number().int(), locationId: z.uuid(), locationName: z.string(), locationAddress: z.string(), timeZone: z.string(),
})
const mineEx = {
  id: SHIFT_ID, date: "2026-11-16", start: "08:00", end: "16:00", startAt: "2026-11-16T08:00:00.000Z", endAt: "2026-11-16T16:00:00.000Z", unpaidBreakMin: 30, role: "Security officer", shiftType: "Day",
  confirmedAt: null, version: 2, locationId: LID, locationName: "Harbour Street", locationAddress: "1 Harbour Street, Dublin", timeZone: "Europe/Dublin",
}
export const MineOut = z
  .object({ from: z.string(), to: z.string(), items: z.array(MineShift), truncated: z.boolean().openapi({ description: "true when the range holds more than the 2000 shifts returned (narrow `from` / `to`)" }), access: AccessOut.openapi({ description: "The caller's roster access as for a PUBLISHED week (my roster only shows published weeks): level null and canEdit false for plain staff" }) })
  .openapi({ example: { from: "2026-11-16", to: "2026-12-13", items: [mineEx], truncated: false, access: { level: null, canEdit: false, locked: false, lockReason: "forbidden" } } })
export type MineDto = z.infer<typeof MineOut>

// ------------------------------------------------------------------ coverage (FR-RS-12)

export const CoverageQuery = z.object({
  from: z.string().max(10).optional().openapi({ description: "First date YYYY-MM-DD (default: today in the tenant zone)", example: "2026-11-16" }),
  to: z.string().max(10).optional().openapi({ description: "Last date, inclusive (default: 6 days after `from`; at most 62 days after it)", example: "2026-11-22" }),
  locationId: z.string().max(64).optional().openapi({ description: "One location (404 when the caller may not see it); omitted: every location the caller sees", example: LID }),
})
const CoverageDay = z.object({
  date: z.string(), weekId: z.uuid(), status: z.enum(["draft", "published"]), staff: z.number().int().openapi({ description: "People assigned that day (open shifts are not people)" }), target: z.number().int(),
  short: z.number().int().openapi({ description: "target - staff, never below 0: an open shift counts as short until somebody takes it" }), over: z.number().int(), open: z.number().int().openapi({ description: "Open shifts that day" }),
})
export const CoverageOut = z
  .object({ from: z.string(), to: z.string(), locations: z.array(z.object({ locationId: z.uuid(), name: z.string(), days: z.array(CoverageDay) })) })
  .openapi({ example: { from: "2026-11-16", to: "2026-11-22", locations: [{ locationId: LID, name: "Harbour Street", days: [{ date: "2026-11-16", weekId: WEEK_ID, status: "published", staff: 2, target: 3, short: 1, over: 0, open: 1 }] }] } })
export type CoverageDto = z.infer<typeof CoverageOut>
