import { beforeEach, describe, expect, test } from "vitest"
import { resetDb } from "../../../test/harness"
import { call, testApp } from "../../../test/harness"
import { makeMember, makeTenant, signIn } from "../../../test/factories"
import { TaskDtoSchema } from "./dto"

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
beforeEach(resetDb)

const UUID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
/** A task with EVERY nested kind filled the way the API fills it (checklist, subtasks, notes, evidence, time entries, proposal, repeat, voice note). */
const full = (): Json => ({
  id: UUID, ref: "TSK-1001", version: 3, title: "Check fire exits", description: "Walk every floor.", dept: "Cleaning", teamId: null,
  assignee: "usr_a", assignees: ["usr_b"], creator: "usr_c", priority: 2,
  start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00", startAt: "2026-11-20T09:00:00.000Z", dueAt: "2026-11-20T17:00:00.000Z",
  status: "in_progress", evidenceRule: { mode: "required", types: ["photo"], min: 1, instruction: "", review: "manager" }, tags: ["safety"], parentId: null,
  checklist: [{ id: UUID, text: "Ground floor", done: true }],
  subtasks: [{ id: UUID, ref: "TSK-1002", title: "Stairwell", status: "not_started" }],
  dependsOn: ["TSK-1000"], dependsOnIds: [UUID], round: 2,
  proposal: { start: "2026-11-21T09:00:00", due: "2026-11-21T17:00:00", reason: "Waiting on keys", by: "Ann Byrne", at: "2026-11-19T10:00:00" },
  repeat: { freq: "weekly", days: [1, 3], until: "2026-12-31" },
  notes: [{ at: "2026-11-19T10:00:00", by: "Ann Byrne", text: "Called the landlord" }],
  evidence: [{ id: UUID, kind: "photo", name: "exit.jpg", by: "Ann Byrne", at: "2026-11-19T10:00:00", review: "pending", round: 1, locked: false, fileId: UUID, fileStatus: "clean", size: 1200 }],
  timeline: [],
  timeEntries: [{ id: UUID, at: "2026-11-19T10:00:00", by: "Ann Byrne", minutes: 30, note: "Walked it", source: "shift_report" }],
  evidenceState: "awaiting",
  voiceNote: { durationSec: 12, mime: "audio/webm", recordedBy: "usr_c", recordedAt: "2026-11-18T09:00:00.000Z" },
})

describe("TaskDtoSchema is typed (B6 T6.1, Review Focus 4)", () => {
  test("TaskDto parses a real task with checklist, subtasks, notes, evidence, time entries, proposal, repeat and voice note", () => {
    const parsed = TaskDtoSchema.parse(full())
    expect(parsed.checklist[0]).toEqual({ id: UUID, text: "Ground floor", done: true })
    expect(parsed.voiceNote).toMatchObject({ durationSec: 12, mime: "audio/webm" })
  })

  test("a task the API really returns parses, and carries the typed empty arrays", async () => {
    const t = testApp()
    const tenant = await makeTenant(t.deps, { slug: "acme" })
    const owner = await makeMember(t.deps, tenant.id, "owner")
    const { cookie } = await signIn(t.app, owner.email, owner.password)
    const r = await call(t.app, "POST", "/v1/tasks", { cookie, tenant: "acme", body: { title: "T", description: "d", priority: 2, start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00", primary: owner.userId } })
    expect(r.status).toBe(201)
    const dto = TaskDtoSchema.parse(await r.json())
    expect(dto.notes).toEqual([])
    expect(dto.timeEntries).toEqual([])
  })

  test.each([
    ["a checklist item without text", { checklist: [{ id: UUID, done: true }] }],
    ["a checklist item with a non-boolean done", { checklist: [{ id: UUID, text: "x", done: "yes" }] }],
    ["a subtask with an unknown status", { subtasks: [{ id: UUID, ref: "TSK-2", title: "x", status: "maybe" }] }],
    ["a note without an author", { notes: [{ at: "2026-11-19T10:00:00", text: "x" }] }],
    ["evidence with an unknown review state", { evidence: [{ ...full().evidence[0], review: "maybe" }] }],
    ["evidence without a name", { evidence: [{ ...full().evidence[0], name: undefined }] }],
    ["a time entry with non-numeric minutes", { timeEntries: [{ ...full().timeEntries[0], minutes: "30" }] }],
    ["a proposal without a reason", { proposal: { start: "a", due: "b", by: "c", at: "d" } }],
    ["a repeat rule with an unknown frequency", { repeat: { freq: "yearly" } }],
    ["a voice note without a duration", { voiceNote: { mime: "audio/webm", recordedBy: "u", recordedAt: "x" } }],
  ])("a malformed nested value fails: %s", (_name, patch) => {
    expect(TaskDtoSchema.safeParse({ ...full(), ...patch }).success).toBe(false)
  })

  test("the OpenAPI schema of the DTO has no untyped array item or free-form object left", () => {
    const json = JSON.stringify(TaskDtoSchema.toJSONSchema?.() ?? {})
    expect(json).not.toMatch(/"items":\{\}/)
    expect(json).not.toMatch(/"additionalProperties":\{\}/)
  })
})
