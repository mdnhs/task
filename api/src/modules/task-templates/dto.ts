import { z } from "@hono/zod-openapi"
import { EvidenceRuleSchema } from "../tasks/dto"

const TID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const UID = "usr_8Kq2mZ4tW1"
const RULE_EX = { mode: "required", types: ["photo"], min: 1, instruction: "", review: "manager" } as const
const Version = z.number().int().min(1).openapi({ description: "The template's current version (optimistic lock); a stale one is 409 version_conflict", example: 1 })
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).openapi({ description: "Tenant-local HH:mm", example: "17:00" })
const Tags = z.array(z.string().max(100)).max(50)

export const TemplateParam = z.object({ id: z.uuid().openapi({ param: { name: "id", in: "path" }, example: TID }) })

/** The `templateFromForm` shape (@opsdesk/domain/task-templates) with ids instead of display names: teamId for dept, an array for tags. A template never carries a voice note (ruling D21). */
export const TemplateCreate = z
  .object({
    name: z.string().trim().min(1).max(80), title: z.string().trim().min(1).max(200), description: z.string().max(10_000).default(""),
    teamId: z.uuid().nullable().optional(), assignee: z.string().min(1).max(128).nullable().optional(), priority: z.number().int().min(1).max(3).default(2),
    tags: Tags.default([]), evidenceRule: EvidenceRuleSchema.optional(), dueOffset: z.number().int().min(0).max(365).default(0), dueTime: Time.default("17:00"),
  })
  .openapi({ example: { name: "Closing checks", title: "Close up", description: "Lock all doors.", priority: 2, tags: ["safety"], evidenceRule: RULE_EX, dueOffset: 0, dueTime: "17:00" } })
export type TemplateCreateInput = z.infer<typeof TemplateCreate>

export const TemplatePatch = z
  .object({
    version: Version, name: z.string().trim().min(1).max(80).optional(), title: z.string().trim().min(1).max(200).optional(), description: z.string().max(10_000).optional(),
    teamId: z.uuid().nullable().optional(), assignee: z.string().min(1).max(128).nullable().optional(), priority: z.number().int().min(1).max(3).optional(),
    tags: Tags.optional(), evidenceRule: EvidenceRuleSchema.optional(), dueOffset: z.number().int().min(0).max(365).optional(), dueTime: Time.optional(),
  })
  .openapi({ example: { version: 1, name: "Closing checks v2", dueOffset: 1 } })
export type TemplatePatchInput = z.infer<typeof TemplatePatch>

export const TemplateSchema = z
  .object({
    id: z.uuid(), name: z.string(), title: z.string(), description: z.string(), dept: z.string(), teamId: z.string().nullable(), assignee: z.string().optional(),
    priority: z.number().int(), tags: z.array(z.string()), evidenceRule: EvidenceRuleSchema, dueOffset: z.number().int(), dueTime: z.string(), createdBy: z.string().nullable(),
    createdAt: z.string(), version: z.number().int(),
  })
  .openapi({
    example: {
      id: TID, name: "Closing checks", title: "Close up", description: "Lock all doors.", dept: "Cleaning", teamId: null, assignee: UID, priority: 2, tags: ["safety"],
      evidenceRule: RULE_EX, dueOffset: 0, dueTime: "17:00", createdBy: UID, createdAt: "2026-11-17T09:00:00.000Z", version: 1,
    },
  })
export type TemplateDto = z.infer<typeof TemplateSchema>

export const TemplateQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().max(400).optional() })
export const TemplateList = z.object({ items: z.array(TemplateSchema), nextCursor: z.string().nullable() }).openapi({ example: { items: [], nextCursor: null } })
