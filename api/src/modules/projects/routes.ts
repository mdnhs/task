import { createRoute } from "@hono/zod-openapi"
import { requireModule } from "../../core/middleware/module"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { mutate, read1 } from "../tasks"
import { MilestoneCreate, MilestoneParams, MilestonePatch, MilestoneSchema, ProjectCreate, ProjectList, ProjectParam, ProjectPatch, ProjectQuery, ProjectSchema } from "./dto"
import { createMilestone, createProject, deleteMilestone, deleteProject, getProjectDetail, listProjects, patchMilestone, patchProject } from "./service"

const read = [requireTenant, requireModule("M1"), requirePermission("tasks", "read")]
const write = [requireTenant, requireModule("M1"), requirePermission("tasks", "write")]
const content = <S extends object>(schema: S) => ({ "application/json": { schema } })
const reqBody = <S extends object>(schema: S) => ({ content: content(schema), required: true as const })

const listR = createRoute({
  method: "get", path: "/v1/projects", middleware: read, request: { query: ProjectQuery },
  responses: { 200: { description: "Projects with milestones and progress, newest first; pass nextCursor back as cursor. Progress counts only live tasks inside the caller's task scope. 400 invalid_cursor", content: content(ProjectList) } },
})
const createR = createRoute({
  method: "post", path: "/v1/projects", middleware: write, request: { body: reqBody(ProjectCreate) },
  responses: { 201: { description: "The new project (managers only). 403 forbidden; 422 invalid_team | invalid_lead | invalid_evidence_rule | invalid_reviewer", content: content(ProjectSchema) } },
})
const getR = createRoute({
  method: "get", path: "/v1/projects/{id}", middleware: read, request: { params: ProjectParam },
  responses: { 200: { description: "The project. 404 project_not_found (also when the caller has no task in it and does not lead it)", content: content(ProjectSchema) } },
})
const patchR = createRoute({
  method: "patch", path: "/v1/projects/{id}", middleware: write, request: { params: ProjectParam, body: reqBody(ProjectPatch) },
  responses: { 200: { description: "The updated project (managers only). 403 forbidden; 404 project_not_found; 409 version_conflict; 422 invalid_team | invalid_lead | invalid_evidence_rule", content: content(ProjectSchema) } },
})
const deleteR = createRoute({
  method: "delete", path: "/v1/projects/{id}", middleware: write, request: { params: ProjectParam },
  responses: { 204: { description: "Deleted and audited; its tasks are unlinked (kept) and its milestones removed. 403 forbidden; 404 project_not_found" } },
})
const msCreateR = createRoute({
  method: "post", path: "/v1/projects/{id}/milestones", middleware: write, request: { params: ProjectParam, body: reqBody(MilestoneCreate) },
  responses: { 201: { description: "The new milestone (managers only). 403 forbidden; 404 project_not_found", content: content(MilestoneSchema) } },
})
const msPatchR = createRoute({
  method: "patch", path: "/v1/projects/{id}/milestones/{milestoneId}", middleware: write, request: { params: MilestoneParams, body: reqBody(MilestonePatch) },
  responses: { 200: { description: "The milestone. A new date tells the assignees of its open tasks. 403 forbidden; 404 project_not_found | milestone_not_found", content: content(MilestoneSchema) } },
})
const msDeleteR = createRoute({
  method: "delete", path: "/v1/projects/{id}/milestones/{milestoneId}", middleware: write, request: { params: MilestoneParams },
  responses: { 204: { description: "Deleted; its tasks are unlinked from it. 403 forbidden; 404 project_not_found | milestone_not_found" } },
})

export const projectRoutes = newRouter()
  .openapi(listR, async (c) => c.json(await read1(c, (tx, ctx) => listProjects(tx, ctx, c.req.valid("query"))), 200))
  .openapi(createR, async (c) => c.json(await mutate(c, (tx, _env, ctx) => createProject(tx, ctx, c.req.valid("json"))), 201))
  .openapi(getR, async (c) => c.json(await read1(c, (tx, ctx) => getProjectDetail(tx, ctx, c.req.valid("param").id)), 200))
  .openapi(patchR, async (c) => c.json(await mutate(c, (tx, _env, ctx) => patchProject(tx, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(deleteR, async (c) => {
    await mutate(c, (tx, env, ctx) => deleteProject(tx, env, ctx, c.req.valid("param").id))
    return c.body(null, 204)
  })
  .openapi(msCreateR, async (c) => c.json(await mutate(c, (tx, _env, ctx) => createMilestone(tx, ctx, c.req.valid("param").id, c.req.valid("json"))), 201))
  .openapi(msPatchR, async (c) => {
    const p = c.req.valid("param")
    return c.json(await mutate(c, (tx, env, ctx) => patchMilestone(tx, env, ctx, p.id, p.milestoneId, c.req.valid("json"))), 200)
  })
  .openapi(msDeleteR, async (c) => {
    const p = c.req.valid("param")
    await mutate(c, (tx, _env, ctx) => deleteMilestone(tx, ctx, p.id, p.milestoneId))
    return c.body(null, 204)
  })
