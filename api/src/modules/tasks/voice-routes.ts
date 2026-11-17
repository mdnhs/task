import { createRoute } from "@hono/zod-openapi"
import { requireModule } from "../../core/middleware/module"
import { requirePermission } from "../../core/middleware/permission"
import { requireTenant } from "../../core/middleware/tenant"
import { newRouter } from "../../core/router"
import { IdParam, TaskDtoSchema } from "./dto"
import { read1 } from "./run"
import { clearVoiceNote, listPlays, mutateVoice, playVoiceNote, PlaysList, PlaysQuery, setVoiceNote, VoiceDeleteBody, VoicePutBody } from "./voice"

const read = [requireTenant, requireModule("M1"), requirePermission("tasks", "read")]
const write = [requireTenant, requireModule("M1"), requirePermission("tasks", "write")]
const content = <S extends object>(schema: S) => ({ "application/json": { schema } })
const reqBody = <S extends object>(schema: S) => ({ content: content(schema), required: true as const })

const voicePut = createRoute({
  method: "put", path: "/v1/tasks/{id}/voice-note", middleware: write, request: { params: IdParam, body: reqBody(VoicePutBody) },
  responses: { 200: { description: "The task with its voice note (the creator or a manager; replaces an earlier note, whose file is deleted unless a recurring instance still uses it; bumps the version). 403 forbidden; 404 task_not_found | file_not_found; 409 version_conflict | task_archived | file_not_ready; 410 file_infected; 422 voice_too_long | file_too_large", content: content(TaskDtoSchema) } },
})
const voiceGet = createRoute({
  method: "get", path: "/v1/tasks/{id}/voice-note", middleware: read, request: { params: IdParam },
  responses: { 302: { description: "Redirect to a 60 s presigned GET (Cache-Control: no-store); the play is logged. 404 task_not_found | voice_note_not_found; 409 file_not_ready; 410 file_infected" } },
})
const voiceDelete = createRoute({
  method: "delete", path: "/v1/tasks/{id}/voice-note", middleware: write, request: { params: IdParam, body: reqBody(VoiceDeleteBody) },
  responses: { 200: { description: "The task without its voice note (the creator or a manager). 403 forbidden; 404 task_not_found | voice_note_not_found; 409 version_conflict | task_archived", content: content(TaskDtoSchema) } },
})
const voicePlays = createRoute({
  method: "get", path: "/v1/tasks/{id}/voice-note/plays", middleware: read, request: { params: IdParam, query: PlaysQuery },
  responses: { 200: { description: "Who played the note, newest first; pass nextCursor back as cursor. Managers of the task only. 400 invalid_cursor; 403 forbidden; 404 task_not_found", content: content(PlaysList) } },
})

export const voiceRoutes = newRouter()
  .openapi(voicePut, async (c) => c.json(await mutateVoice(c, (tx, env, ctx) => setVoiceNote(tx, env, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(voiceGet, async (c) => {
    const url = await playVoiceNote(c, c.req.valid("param").id)
    c.header("Cache-Control", "no-store")
    return c.redirect(url, 302)
  })
  .openapi(voiceDelete, async (c) => c.json(await mutateVoice(c, (tx, env, ctx) => clearVoiceNote(tx, env, ctx, c.req.valid("param").id, c.req.valid("json"))), 200))
  .openapi(voicePlays, async (c) => c.json(await read1(c, (tx, ctx) => listPlays(tx, ctx, c.req.valid("param").id, c.req.valid("query"))), 200))
