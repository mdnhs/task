import { createRoute } from "@hono/zod-openapi"
import { requireModule } from "../../core/middleware/module"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { IdParam, TaskDtoSchema } from "./dto"
import { ApproveBody, approveProposal, declineProposal, DeclineBody, DependenciesBody, previewReschedule, PreviewBody, PreviewSchema, proposeDates, ProposeBody, RescheduleBody, rescheduleTask, setDependencies } from "./planning"
import { mutate, read1 } from "./run"

const write = [requireTenant, requireModule("M1"), requirePermission("tasks", "write")]
const content = <S extends object>(schema: S) => ({ "application/json": { schema } })
const reqBody = <S extends object>(schema: S) => ({ content: content(schema), required: true as const })
const task = (description: string) => ({ 200: { description, content: content(TaskDtoSchema) } })

const depsR = createRoute({
  method: "put", path: "/v1/tasks/{id}/dependencies", middleware: write, request: { params: IdParam, body: reqBody(DependenciesBody) },
  responses: task("The task with its new finish-to-start dependencies (managers; at most 20). 403 forbidden; 404 task_not_found; 409 version_conflict; 422 dependency_cycle | invalid_dependency"),
})
const previewR = createRoute({
  method: "post", path: "/v1/tasks/{id}/reschedule/preview", middleware: write, request: { params: IdParam, body: reqBody(PreviewBody) },
  responses: { 200: { description: "Every open dependant the new dates would push, down the chain, and a hash of them. Moves outside the caller's scope are flagged outOfScope. 403 forbidden; 404 task_not_found; 422 invalid_dates", content: content(PreviewSchema) } },
})
const rescheduleR = createRoute({
  method: "post", path: "/v1/tasks/{id}/reschedule", middleware: write, request: { params: IdParam, body: reqBody(RescheduleBody) },
  responses: task("Rescheduled (and, with knockOn.apply, its previewed dependants). 403 forbidden; 404 task_not_found; 409 version_conflict | knock_on_changed | knock_on_out_of_scope; 422 invalid_dates"),
})
const proposeR = createRoute({
  method: "post", path: "/v1/tasks/{id}/date-proposal", middleware: write, request: { params: IdParam, body: reqBody(ProposeBody) },
  responses: task("An assignee proposes new dates; the managers in scope are told. 403 forbidden; 404 task_not_found; 422 invalid_dates"),
})
const approveR = createRoute({
  method: "post", path: "/v1/tasks/{id}/date-proposal/approve", middleware: write, request: { params: IdParam, body: reqBody(ApproveBody) },
  responses: task("The proposal becomes a reschedule (knock-on rules apply). 403 forbidden; 404 task_not_found; 409 version_conflict | knock_on_changed | knock_on_out_of_scope; 422 no_proposal"),
})
const declineR = createRoute({
  method: "post", path: "/v1/tasks/{id}/date-proposal/decline", middleware: write, request: { params: IdParam, body: reqBody(DeclineBody) },
  responses: task("The proposal is cleared and the assignees are told. 403 forbidden; 404 task_not_found; 409 version_conflict; 422 no_proposal"),
})

export const planningRoutes = newRouter()
  .openapi(depsR, async (c) => c.json(await mutate(c, (tx, env, ctx) => setDependencies(tx, env, ctx, c.req.valid("param").id, c.req.valid("json")), { graphLock: true }), 200))
  .openapi(previewR, async (c) => c.json(await read1(c, (tx, ctx) => previewReschedule(tx, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(rescheduleR, async (c) => {
    const body = c.req.valid("json")
    return c.json(await mutate(c, (tx, env, ctx) => rescheduleTask(tx, env, ctx, c.req.valid("param").id, body), { graphLock: body.knockOn.apply }), 200)
  })
  .openapi(proposeR, async (c) => c.json(await mutate(c, (tx, env, ctx) => proposeDates(tx, env, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(approveR, async (c) => {
    const body = c.req.valid("json")
    return c.json(await mutate(c, (tx, env, ctx) => approveProposal(tx, env, ctx, c.req.valid("param").id, body), { graphLock: body.knockOn.apply }), 200)
  })
  .openapi(declineR, async (c) => c.json(await mutate(c, (tx, env, ctx) => declineProposal(tx, env, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
