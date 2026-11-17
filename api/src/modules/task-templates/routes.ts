import { createRoute } from "@hono/zod-openapi"
import { requireModule } from "../../core/middleware/module"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { mutate, read1 } from "../tasks"
import { TemplateCreate, TemplateList, TemplateParam, TemplatePatch, TemplateQuery, TemplateSchema } from "./dto"
import { createTemplate, deleteTemplate, listTemplates, patchTemplate } from "./service"

const read = [requireTenant, requireModule("M1"), requirePermission("tasks", "read")]
const write = [requireTenant, requireModule("M1"), requirePermission("tasks", "write")]
const content = <S extends object>(schema: S) => ({ "application/json": { schema } })
const reqBody = <S extends object>(schema: S) => ({ content: content(schema), required: true as const })

const listR = createRoute({
  method: "get", path: "/v1/task-templates", middleware: read, request: { query: TemplateQuery },
  responses: { 200: { description: "Templates by name; pass nextCursor back as cursor. 400 invalid_cursor", content: content(TemplateList) } },
})
const createR = createRoute({
  method: "post", path: "/v1/task-templates", middleware: write, request: { body: reqBody(TemplateCreate) },
  responses: { 201: { description: "The new template (managers only). 403 forbidden; 422 invalid_team | invalid_assignee | assignee_out_of_scope | invalid_labels | invalid_evidence_rule | invalid_reviewer", content: content(TemplateSchema) } },
})
const patchR = createRoute({
  method: "patch", path: "/v1/task-templates/{id}", middleware: write, request: { params: TemplateParam, body: reqBody(TemplatePatch) },
  responses: { 200: { description: "The updated template (managers only). 403 forbidden; 404 template_not_found; 409 version_conflict; 422 as for create", content: content(TemplateSchema) } },
})
const deleteR = createRoute({
  method: "delete", path: "/v1/task-templates/{id}", middleware: write, request: { params: TemplateParam },
  responses: { 204: { description: "Deleted and audited (managers only). 403 forbidden; 404 template_not_found" } },
})

export const templateRoutes = newRouter()
  .openapi(listR, async (c) => c.json(await read1(c, (tx, ctx) => listTemplates(tx, ctx, c.req.valid("query"))), 200))
  .openapi(createR, async (c) => c.json(await mutate(c, (tx, _env, ctx) => createTemplate(tx, ctx, c.req.valid("json"))), 201))
  .openapi(patchR, async (c) => c.json(await mutate(c, (tx, _env, ctx) => patchTemplate(tx, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(deleteR, async (c) => {
    await mutate(c, (tx, _env, ctx) => deleteTemplate(tx, ctx, c.req.valid("param").id))
    return c.body(null, 204)
  })
