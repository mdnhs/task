import { z } from "@hono/zod-openapi"

const LID = "7c9e6679-7425-40de-944b-e07fc1f90ae7"
const STID = "0b6f4c1e-8f0e-4c53-9a3e-6a4c1b2d7e90"
const UID = "usr_8Kq2mZ4tW1"

/**
 * Loose on purpose: a roster id of any other shape must answer EXACTLY like one that does not exist (404, R8-4), never a 400 that tells a prober
 * the id was malformed. The services turn a non-uuid into the same 404 before an id reaches SQL (scope.ts `assertLocation`, `uuidOr404`).
 */
export const RosterIdParam = z.object({ id: z.string().min(1).max(64) })
export const RosterUserParam = z.object({ userId: z.string().min(1).max(128) })

// ------------------------------------------------------------------ locations

/** Free-form per-day opening text (e.g. mon: "08:00-22:00"), at most 14 entries: the UI shows it, nothing computes with it. */
const OpeningHours = z.record(z.string().max(20), z.string().max(100))

export const LocationOut = z.object({
  id: z.uuid(), name: z.string(), address: z.string(), lat: z.number().nullable(), lng: z.number().nullable(), zoneRadiusM: z.number().int().nullable(),
  openingHours: OpeningHours, contact: z.string(), swapApprovalDelegated: z.boolean(), timeZone: z.string().nullable(), version: z.number().int(),
  archived: z.boolean(), supervisorIds: z.array(z.string()),
})
export type LocationDto = z.infer<typeof LocationOut>

const locationEx = {
  id: LID, name: "Harbour Street", address: "1 Harbour Street, Dublin", lat: 53.3498, lng: -6.2603, zoneRadiusM: 150, openingHours: { mon: "08:00-22:00" }, contact: "+353 1 555 0100",
  swapApprovalDelegated: false, timeZone: null, version: 1, archived: false, supervisorIds: [UID],
}
export const LocationSchema = LocationOut.openapi({ example: locationEx })
export const LocationsOut = z.object({ items: z.array(LocationOut) }).openapi({ example: { items: [locationEx] } })
export const LocationsQuery = z.object({ includeArchived: z.enum(["true", "false"]).optional().openapi({ description: "Also list archived locations (default false)", example: "false" }) })

// Loose number/string types: the service validates (ranges, IANA zone) and answers 422 with a specific code instead of the generic 400.
const Text = z.string().max(400)
export const CreateLocationBody = z
  .object({
    name: z.string().max(200), address: Text.optional(), lat: z.number().nullable().optional(), lng: z.number().nullable().optional(), zoneRadiusM: z.number().nullable().optional(),
    openingHours: OpeningHours.optional(), contact: Text.optional(), swapApprovalDelegated: z.boolean().optional(), timeZone: z.string().max(100).nullable().optional(),
  })
  .openapi({ example: { name: "Harbour Street", address: "1 Harbour Street, Dublin", lat: 53.3498, lng: -6.2603, zoneRadiusM: 150, timeZone: "Europe/Dublin" } })
export const PatchLocationBody = z
  .object({
    version: z.number().int().min(1), name: z.string().max(200).optional(), address: Text.optional(), lat: z.number().nullable().optional(), lng: z.number().nullable().optional(),
    zoneRadiusM: z.number().nullable().optional(), openingHours: OpeningHours.optional(), contact: Text.optional(), swapApprovalDelegated: z.boolean().optional(), timeZone: z.string().max(100).nullable().optional(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== "version" && (v as Record<string, unknown>)[k] !== undefined), { message: "nothing to change" })
  .openapi({ example: { version: 1, contact: "+353 1 555 0101", swapApprovalDelegated: true } })

export const SupervisorsBody = z.object({ userIds: z.array(z.string().min(1).max(128)).max(100) }).openapi({ example: { userIds: [UID] } })
export const SupervisorsOut = z.object({ locationId: z.uuid(), userIds: z.array(z.string()) }).openapi({ example: { locationId: LID, userIds: [UID] } })

// ------------------------------------------------------------------ shift types

const TargetOut = z.object({ weekday: z.number().int(), count: z.number().int() })
export const ShiftTypeOut = z.object({
  id: z.uuid(), locationId: z.uuid(), name: z.string(), start: z.string(), end: z.string(), unpaidBreakMin: z.number().int(), role: z.string(), requires: z.array(z.string()),
  targets: z.array(TargetOut), archived: z.boolean(), version: z.number().int(),
})
export type ShiftTypeDto = z.infer<typeof ShiftTypeOut>
const shiftTypeEx = {
  id: STID, locationId: LID, name: "Night", start: "22:00", end: "06:00", unpaidBreakMin: 30, role: "Security officer", requires: ["SIA licence"],
  targets: [{ weekday: 1, count: 2 }, { weekday: 5, count: 3 }], archived: false, version: 1,
}
export const ShiftTypeSchema = ShiftTypeOut.openapi({ example: shiftTypeEx })
export const ShiftTypesOut = z.object({ items: z.array(ShiftTypeOut) }).openapi({ example: { items: [shiftTypeEx] } })
export const ShiftTypesQuery = z.object({ includeArchived: z.enum(["true", "false"]).optional().openapi({ description: "Also list archived types (default false); rostered shifts keep their type either way", example: "false" }) })

const Hm = z.string().max(10)
const Requires = z.array(z.string().max(200)).max(100)
export const CreateShiftTypeBody = z
  .object({ name: z.string().max(200), start: Hm, end: Hm, unpaidBreakMin: z.number().optional(), role: z.string().max(200), requires: Requires.optional() })
  .openapi({ example: { name: "Night", start: "22:00", end: "06:00", unpaidBreakMin: 30, role: "Security officer", requires: ["SIA licence"] } })
export const PatchShiftTypeBody = z
  .object({ version: z.number().int().min(1), name: z.string().max(200).optional(), start: Hm.optional(), end: Hm.optional(), unpaidBreakMin: z.number().optional(), role: z.string().max(200).optional(), requires: Requires.optional() })
  .refine((v) => Object.keys(v).some((k) => k !== "version" && (v as Record<string, unknown>)[k] !== undefined), { message: "nothing to change" })
  .openapi({ example: { version: 1, end: "07:00" } })
export const TargetsBody = z
  .object({ targets: z.array(z.object({ weekday: z.number(), count: z.number() })).max(7) })
  .openapi({ example: { targets: [{ weekday: 1, count: 2 }, { weekday: 5, count: 3 }] } })

// ------------------------------------------------------------------ office limits

export const OfficeLimitBody = z.object({ except: z.array(z.string().max(64)).max(500) }).openapi({ example: { except: [LID] } })
export const OfficeLimitOut = z.object({ userId: z.string(), except: z.array(z.uuid()) }).openapi({ example: { userId: UID, except: [LID] } })
