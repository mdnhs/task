import { z } from "@hono/zod-openapi"
import type { PatternRow, AssignmentRow } from "./occurrences"

const PID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const AID = "0b6f4c1e-8f0e-4c53-9a3e-6a4c1b2d7e90"
const TID = "a3d2c1b0-5e4f-4a6b-8c7d-9e0f1a2b3c4d"
const UID = "usr_8Kq2mZ4tW1"

export const IdParam = z.object({ id: z.uuid() })
export const TeamParam = z.object({ teamId: z.uuid() })
export const UserParam = z.object({ userId: z.string().min(1).max(128) })

/** A real calendar date `YYYY-MM-DD`. */
export const validDate = (d: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().startsWith(d)

const PatternOut = z.object({
  id: z.uuid(), name: z.string(), teamId: z.uuid(), start: z.string(), end: z.string(), days: z.array(z.number().int()), timeZone: z.string().nullable(), version: z.number().int(),
})
const AssignmentOut = z.object({ id: z.uuid(), userId: z.string(), patternId: z.uuid(), from: z.string(), until: z.string().nullable() })

export type PatternDto = z.infer<typeof PatternOut>
export type AssignmentDto = z.infer<typeof AssignmentOut>
export const patternDto = (p: PatternRow): PatternDto => ({ id: p.id, name: p.name, teamId: p.teamId, start: p.startTime, end: p.endTime, days: [...p.days].sort((a, b) => a - b), timeZone: p.timeZone, version: p.version })
export const assignmentDto = (a: AssignmentRow): AssignmentDto => ({ id: a.id, userId: a.userId, patternId: a.patternId, from: a.fromDate, until: a.untilDate })

const patternEx = { id: PID, name: "Night", teamId: TID, start: "22:00", end: "06:00", days: [0, 1, 2, 3, 4, 5, 6], timeZone: null, version: 1 }
const assignmentEx = { id: AID, userId: UID, patternId: PID, from: "2026-10-01", until: null }

export const PatternSchema = PatternOut.openapi({ example: patternEx })
export const AssignmentSchema = AssignmentOut.openapi({ example: assignmentEx })

export const ShiftsOut = z
  .object({
    patterns: z.array(PatternOut),
    assignments: z.array(AssignmentOut),
    members: z.array(z.object({ userId: z.string(), teams: z.array(z.string()), managerId: z.string().nullable() })),
    reporting: z.object({ dueAfterMinutes: z.number().int(), teamDefaults: z.record(z.string(), z.boolean()), overrides: z.record(z.string(), z.boolean()) }),
  })
  .openapi({
    example: {
      patterns: [patternEx], assignments: [assignmentEx], members: [{ userId: UID, teams: [TID], managerId: "usr_Mgr1" }],
      reporting: { dueAfterMinutes: 60, teamDefaults: { [TID]: true }, overrides: { [UID]: false } },
    },
  })

const Day = /^\d{4}-\d{2}-\d{2}$/
export const OccurrencesQuery = z.object({
  from: z.string().regex(Day).openapi({ description: "First shift START date, YYYY-MM-DD (in the pattern's own zone)", example: "2026-10-19" }),
  to: z.string().regex(Day).openapi({ description: "Last shift START date, inclusive; at most 31 dates from `from`", example: "2026-10-25" }),
  userId: z.string().min(1).max(128).optional().openapi({ description: "One member (staff see only their own shifts whatever is asked)" }),
})
const OccurrenceOut = z.object({
  userId: z.string(), patternId: z.uuid(), name: z.string(), teamId: z.uuid(), shiftDate: z.string(), start: z.string(), end: z.string(), startAt: z.string(), endAt: z.string(),
  minutes: z.number().int(), endsNextDay: z.boolean(), reportsOn: z.boolean(),
})
export type OccurrenceDto = z.infer<typeof OccurrenceOut>
export const OccurrencesOut = z
  .object({ items: z.array(OccurrenceOut) })
  .openapi({
    example: {
      items: [{
        userId: UID, patternId: PID, name: "Night", teamId: TID, shiftDate: "2026-10-24", start: "2026-10-24T22:00", end: "2026-10-25T06:00", startAt: "2026-10-24T21:00:00.000Z", endAt: "2026-10-25T06:00:00.000Z",
        minutes: 540, endsNextDay: true, reportsOn: true,
      }],
    },
  })

// Loose on purpose: the service validates (HH:MM, weekdays, zone) and answers 422 with a specific code instead of the generic 400.
const Name = z.string().max(200)
const Hm = z.string().max(10)
const Days = z.array(z.number().int()).max(14)
const Zone = z.string().max(100)
export const CreatePatternBody = z
  .object({ name: Name, teamId: z.uuid(), start: Hm, end: Hm, days: Days, timeZone: Zone.nullable().optional() })
  .openapi({ example: { name: "Night", teamId: TID, start: "22:00", end: "06:00", days: [0, 1, 2, 3, 4, 5, 6] } })
export const PatchPatternBody = z
  .object({ version: z.number().int().min(1), name: Name.optional(), teamId: z.uuid().optional(), start: Hm.optional(), end: Hm.optional(), days: Days.optional(), timeZone: Zone.nullable().optional() })
  .refine((v) => Object.keys(v).some((k) => k !== "version" && (v as Record<string, unknown>)[k] !== undefined), { message: "nothing to change" })
  .openapi({ example: { version: 1, end: "07:00" } })
export const CreateAssignmentBody = z
  .object({ userId: z.string().min(1).max(128), patternId: z.uuid(), from: z.string().max(10), until: z.string().max(10).nullable().optional() })
  .openapi({ example: { userId: UID, patternId: PID, from: "2026-10-26" } })
export const PatchAssignmentBody = z.object({ until: z.string().max(10).nullable() }).openapi({ example: { until: "2026-11-30" } })
export const TeamReportingBody = z.object({ on: z.boolean() }).openapi({ example: { on: true } })
export const PersonReportingBody = z.object({ on: z.boolean().nullable() }).openapi({ example: { on: false } })
export const TeamReportingOut = z.object({ teamId: z.uuid(), on: z.boolean() }).openapi({ example: { teamId: TID, on: true } })
export const PersonReportingOut = z.object({ userId: z.string(), on: z.boolean().nullable() }).openapi({ example: { userId: UID, on: false } })
