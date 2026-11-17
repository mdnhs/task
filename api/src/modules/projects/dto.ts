import { z } from "@hono/zod-openapi"

const PID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const UID = "usr_8Kq2mZ4tW1"
const Day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => {
    const t = new Date(`${d}T00:00:00Z`)
    return !Number.isNaN(t.getTime()) && t.toISOString().startsWith(d)
  })
  .openapi({ description: "Tenant-local calendar day YYYY-MM-DD (ruling D3)", example: "2026-12-18" })
const Version = z.number().int().min(1).openapi({ description: "The project's current version (optimistic lock); a stale one is 409 version_conflict", example: 1 })
const Rule = z
  .object({
    mode: z.enum(["none", "optional", "required"]),
    types: z.array(z.enum(["photo", "image", "pdf", "office", "video", "checklist", "signature", "note", "drive"])).max(9),
    min: z.number().int().min(0).max(20),
    instruction: z.string().max(200),
    review: z.enum(["auto", "creator", "manager", "named"]),
    reviewer: z.string().max(128).optional(),
  })
  .openapi({ example: { mode: "required", types: ["photo"], min: 1, instruction: "", review: "manager" } })

export const ProjectParam = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" }, example: PID }) })
export const MilestoneParams = z.object({
  id: z.uuid().openapi({ param: { name: "id", in: "path" }, example: PID }),
  milestoneId: z.uuid().openapi({ param: { name: "milestoneId", in: "path" }, example: PID }),
})

export const ProjectCreate = z
  .object({
    name: z.string().trim().min(1).max(120), teamId: z.uuid().nullable().optional(), leadId: z.string().min(1).max(128).nullable().optional(),
    description: z.string().max(4000).default(""), due: Day.nullable().optional(), defaultEvidenceRule: Rule.nullable().optional(),
  })
  .openapi({ example: { name: "Office move", description: "Move to the new floor.", leadId: UID, due: "2026-12-18" } })
export type ProjectCreateInput = z.infer<typeof ProjectCreate>

export const ProjectPatch = z
  .object({
    version: Version, name: z.string().trim().min(1).max(120).optional(), teamId: z.uuid().nullable().optional(), leadId: z.string().min(1).max(128).nullable().optional(),
    description: z.string().max(4000).optional(), due: Day.nullable().optional(), defaultEvidenceRule: Rule.nullable().optional(),
  })
  .openapi({ example: { version: 1, due: "2027-01-15" } })
export type ProjectPatchInput = z.infer<typeof ProjectPatch>

export const MilestoneCreate = z.object({ name: z.string().trim().min(1).max(120), due: Day }).openapi({ example: { name: "Furniture delivered", due: "2026-12-04" } })
export const MilestonePatch = z
  .object({ name: z.string().trim().min(1).max(120).optional(), due: Day.optional(), position: z.number().int().min(0).max(1000).optional() })
  .refine((b) => b.name !== undefined || b.due !== undefined || b.position !== undefined)
  .openapi({ example: { due: "2026-12-11" } })
export type MilestonePatchInput = z.infer<typeof MilestonePatch>

const Progress = z.object({ done: z.number().int(), total: z.number().int(), pct: z.number().int() })
export const MilestoneSchema = z
  .object({ id: z.uuid(), name: z.string(), due: z.string(), position: z.number().int(), state: z.enum(["done", "late", "open"]), done: z.number().int(), total: z.number().int(), pct: z.number().int() })
  .openapi({ example: { id: PID, name: "Furniture delivered", due: "2026-12-04", position: 0, state: "open", done: 0, total: 0, pct: 0 } })
export const ProjectSchema = z
  .object({
    id: z.uuid(), name: z.string(), teamId: z.string().nullable(), dept: z.string(), leadId: z.string().nullable(), lead: z.string(), description: z.string(), due: z.string().nullable(),
    defaultEvidenceRule: Rule.nullable(), createdAt: z.string(), updatedAt: z.string(), version: z.number().int(), progress: Progress, milestones: z.array(MilestoneSchema),
  })
  .openapi({
    example: {
      id: PID, name: "Office move", teamId: null, dept: "", leadId: UID, lead: UID, description: "Move to the new floor.", due: "2026-12-18", defaultEvidenceRule: null,
      createdAt: "2026-11-17T09:00:00.000Z", updatedAt: "2026-11-17T09:00:00.000Z", version: 1, progress: { done: 0, total: 0, pct: 0 }, milestones: [],
    },
  })
export const ProjectList = z.object({ items: z.array(ProjectSchema), nextCursor: z.string().nullable() }).openapi({ example: { items: [], nextCursor: null } })
export const ProjectQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(300).optional() })
export type ProjectDto = z.infer<typeof ProjectSchema>
export type MilestoneDto = z.infer<typeof MilestoneSchema>
