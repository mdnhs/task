// The browser side of tasks (B6 T6.6): every write is ONE call to the API through the BFF, with the API's shapes. Errors are ApiErrors: the caller shows userMessage(e).
// Rules kept here so no component can break them:
//  - every task write sends the task's CURRENT `version` (D4); a task without one throws instead of guessing (never a silent default);
//  - the id in every path is the uuid (the `ref` is only for display, I11); nothing here makes up an id;
//  - an upload is intent -> direct PUT of the bytes -> complete -> wait until the malware scan says clean (D10); an infected file is refused, never attached;
//  - a voice note is never read through a URL kept by the client: playUrl() is a path on OUR origin that the API answers with a 60 s redirect, one logged play per call (D21).
import type { ApiClient } from "@/lib/api/client"
import { classifyApiError } from "@/lib/api/problem"
import type { EvidenceRule, RepeatRule, Task } from "./types"
import { toPatch, toTaskBody, type TaskForm } from "./adapters"

type Ref = Pick<Task, "id" | "version">
const idOf = (t: Pick<Task, "id">): string => t.id ?? bad("id")
const verOf = (t: Pick<Task, "version">): number => t.version ?? bad("version")
const bad = (what: string): never => {
  throw new Error(`tasks: a write needs the task ${what}`)
}

/** A file the server refused after scanning (infected) or that never became clean in time. The message is ours, never the server's text. */
export class FileRefused extends Error {
  readonly reason: "infected" | "slow" | "upload"
  constructor(reason: "infected" | "slow" | "upload") {
    super(`tasks: file ${reason}`)
    this.name = "FileRefused"
    this.reason = reason
  }
}

export type UploadFile = { name: string; type: string; size: number; arrayBuffer(): Promise<ArrayBuffer> }
export type Waiter = (ms: number) => Promise<void>
const sleep: Waiter = (ms) => new Promise((r) => setTimeout(r, ms))

export function makeTasksClient(api: ApiClient, put: typeof fetch = (...a) => fetch(...a), wait: Waiter = sleep) {
  /** Intent, PUT with exactly the headers the API signed, complete, then wait for `clean`. `complete` is idempotent, so it doubles as the status poll. */
  async function upload(taskId: string, purpose: "evidence" | "voice" | "attachment", file: UploadFile, onScanning?: () => void): Promise<string> {
    const intent = await api.post("/v1/tasks/{id}/uploads", { path: { id: taskId }, body: { purpose, name: file.name, mime: file.type, sizeBytes: file.size } })
    const res = await put(intent.upload.url, { method: "PUT", headers: intent.upload.headers, body: await file.arrayBuffer() })
    if (!res.ok) throw new FileRefused("upload")
    onScanning?.()
    for (let i = 0; i < 40; i++) {
      const f = await api.post("/v1/tasks/{id}/uploads/{fileId}/complete", { path: { id: taskId, fileId: intent.fileId } })
      if (f.status === "clean") return intent.fileId
      if (f.status === "infected" || f.status === "deleted") throw new FileRefused("infected")
      await wait(1000)
    }
    throw new FileRefused("slow")
  }

  return {
    upload,

    // ---- create (two or three calls, I13: the task stays if a later one fails) ----
    async create(form: TaskForm) {
      return api.post("/v1/tasks", { body: toTaskBody(form) })
    },
    async setRepeat(t: Ref, rule: RepeatRule | null) {
      return api.put("/v1/tasks/{id}/repeat", { path: { id: idOf(t) }, body: { version: verOf(t), rule } })
    },

    // ---- fields and people ----
    async patch(prev: Task, next: Task) {
      return api.patch("/v1/tasks/{id}", { path: { id: idOf(prev) }, body: toPatch(prev, next) })
    },
    async setAssignees(t: Ref, primary: string, others: string[]) {
      return api.put("/v1/tasks/{id}/assignees", { path: { id: idOf(t) }, body: { version: verOf(t), primary, others } })
    },
    async setStatus(t: Ref, to: Task["status"]) {
      return api.post("/v1/tasks/{id}/status", { path: { id: idOf(t) }, body: { version: verOf(t), to } })
    },
    async complete(t: Ref) {
      return api.post("/v1/tasks/{id}/complete", { path: { id: idOf(t) }, body: { version: verOf(t) } })
    },
    async setDependencies(t: Ref, dependsOnIds: string[]) {
      return api.put("/v1/tasks/{id}/dependencies", { path: { id: idOf(t) }, body: { version: verOf(t), dependsOnIds } })
    },

    // ---- evidence and review (D8: the API refuses a self-verification with 403 self_verification, whatever the UI showed) ----
    async setEvidenceRule(t: Ref, rule: EvidenceRule) {
      return api.put("/v1/tasks/{id}/evidence-rule", { path: { id: idOf(t) }, body: { version: verOf(t), rule } })
    },
    /** A file item: upload, wait until clean, then attach. */
    async addFileEvidence(t: Pick<Task, "id">, kind: "photo" | "image" | "pdf" | "office" | "video" | "signature", file: UploadFile, o: { source?: "camera" | "upload"; capturedAt?: string; onScanning?: () => void } = {}) {
      const fileId = await upload(idOf(t), "evidence", file, o.onScanning)
      return api.post("/v1/tasks/{id}/evidence", { path: { id: idOf(t) }, body: { kind, fileId, ...(o.source ? { source: o.source } : {}), ...(o.capturedAt ? { capturedAt: o.capturedAt } : {}) } })
    },
    async addNoteEvidence(t: Pick<Task, "id">, text: string) {
      return api.post("/v1/tasks/{id}/evidence", { path: { id: idOf(t) }, body: { kind: "note", text } })
    },
    async addDriveEvidence(t: Pick<Task, "id">, url: string) {
      return api.post("/v1/tasks/{id}/evidence", { path: { id: idOf(t) }, body: { kind: "drive", url } })
    },
    async addChecklistEvidence(t: Pick<Task, "id">) {
      return api.post("/v1/tasks/{id}/evidence", { path: { id: idOf(t) }, body: { kind: "checklist" } })
    },
    async removeEvidence(t: Pick<Task, "id">, evidenceId: string) {
      await api.delete("/v1/tasks/{id}/evidence/{evidenceId}", { path: { id: idOf(t), evidenceId } })
    },
    async verify(t: Ref, evidenceIds?: string[]) {
      return api.post("/v1/tasks/{id}/verify", { path: { id: idOf(t) }, body: { version: verOf(t), ...(evidenceIds ? { evidenceIds } : {}) } })
    },
    async reject(t: Ref, reason: string, evidenceIds?: string[]) {
      return api.post("/v1/tasks/{id}/reject", { path: { id: idOf(t) }, body: { version: verOf(t), reason, ...(evidenceIds ? { evidenceIds } : {}) } })
    },

    // ---- reschedule: preview first, then apply WITH the preview's hash (D20); a changed picture is 409 knock_on_changed and the caller shows the preview again ----
    async previewReschedule(t: Pick<Task, "id">, to: { start: string; due: string }) {
      return api.post("/v1/tasks/{id}/reschedule/preview", { path: { id: idOf(t) }, body: to })
    },
    async reschedule(t: Ref, to: { start: string; due: string; reason?: string }, knockOn: { apply: false } | { apply: true; previewHash: string }) {
      return api.post("/v1/tasks/{id}/reschedule", { path: { id: idOf(t) }, body: { version: verOf(t), start: to.start, due: to.due, ...(to.reason ? { reason: to.reason } : {}), knockOn } })
    },
    async propose(t: Pick<Task, "id">, p: { start: string; due: string; reason: string }) {
      return api.post("/v1/tasks/{id}/date-proposal", { path: { id: idOf(t) }, body: p })
    },
    async approveProposal(t: Ref, knockOn: { apply: false } | { apply: true; previewHash: string }) {
      return api.post("/v1/tasks/{id}/date-proposal/approve", { path: { id: idOf(t) }, body: { version: verOf(t), knockOn } })
    },
    async declineProposal(t: Ref, reason?: string) {
      return api.post("/v1/tasks/{id}/date-proposal/decline", { path: { id: idOf(t) }, body: { version: verOf(t), ...(reason ? { reason } : {}) } })
    },

    // ---- archive, restore, purge ----
    async archive(t: Ref) {
      return api.post("/v1/tasks/{id}/archive", { path: { id: idOf(t) }, body: { version: verOf(t) } })
    },
    async restore(t: Pick<Task, "id">) {
      return api.post("/v1/tasks/{id}/restore", { path: { id: idOf(t) }, body: {} })
    },
    async purge(t: Pick<Task, "id">) {
      await api.delete("/v1/tasks/{id}", { path: { id: idOf(t) } })
    },

    // ---- checklist (absolute `done`, never a toggle: two clicks cannot flip it twice), comments, subtasks ----
    async addChecklistItem(t: Pick<Task, "id">, text: string) {
      return api.post("/v1/tasks/{id}/checklist", { path: { id: idOf(t) }, body: { text } })
    },
    async setChecklistDone(t: Pick<Task, "id">, itemId: string, done: boolean) {
      return api.patch("/v1/tasks/{id}/checklist/{itemId}", { path: { id: idOf(t), itemId }, body: { done } })
    },
    async removeChecklistItem(t: Pick<Task, "id">, itemId: string) {
      await api.delete("/v1/tasks/{id}/checklist/{itemId}", { path: { id: idOf(t), itemId } })
    },
    /** `mentions` are USER IDS. */
    async comment(t: Pick<Task, "id">, body: string, mentions: string[] = []) {
      return api.post("/v1/tasks/{id}/comments", { path: { id: idOf(t) }, body: { body, mentions, attachmentFileIds: [] } })
    },
    async addSubtask(t: Pick<Task, "id">, title: string) {
      return api.post("/v1/tasks/{id}/subtasks", { path: { id: idOf(t) }, body: { title } })
    },

    // ---- voice note (D21): 120 s and 3 MiB, the creator or a manager; played through the API, one logged play per click ----
    async setVoice(t: Ref, audio: UploadFile, durationSec: number) {
      const sec = Math.ceil(durationSec)
      if (!Number.isFinite(sec) || sec < 1) throw new Error("tasks: the voice note is empty")
      if (sec > VOICE_MAX_SEC) throw new VoiceTooLong()
      const fileId = await upload(idOf(t), "voice", audio)
      return api.put("/v1/tasks/{id}/voice-note", { path: { id: idOf(t) }, body: { version: verOf(t), fileId, durationSec: sec } })
    },
    async clearVoice(t: Ref) {
      return api.delete("/v1/tasks/{id}/voice-note", { path: { id: idOf(t) }, body: { version: verOf(t) } })
    },
    /** Who played the note (managers of the task only; others get 403). */
    async voicePlays(t: Pick<Task, "id">) {
      return api.get("/v1/tasks/{id}/voice-note/plays", { path: { id: idOf(t) }, query: { limit: 50 } })
    },
  }
}

export const VOICE_MAX_SEC = 120
/** The recording is over the 120 s limit: caught before any upload (the API says 422 voice_too_long as well). */
export class VoiceTooLong extends Error {
  constructor() {
    super("tasks: voice too long")
    this.name = "VoiceTooLong"
  }
}

/**
 * The path a player loads for ONE play: our own origin, a fresh `play` value every call so the browser never reuses a cached answer, and no credential in it. The API
 * answers with a 60 s presigned redirect (no-store) and logs the play. Nothing here is ever stored, and no signed URL ever reaches this code.
 */
export const playUrl = (taskId: string, nonce: string): string => `/v1/tasks/${encodeURIComponent(taskId)}/voice-note?play=${encodeURIComponent(nonce)}`

export type TasksClient = ReturnType<typeof makeTasksClient>

type Rule = EvidenceRule | null
/** Projects, milestones and templates (managers). A project delete and a milestone delete are all-scope managers only (403 forbidden otherwise: the caller shows the mapped copy). */
export function makeCatalogClient(api: ApiClient) {
  return {
    async createProject(b: { name: string; teamId?: string | null; leadId?: string | null; description?: string; due?: string | null; defaultEvidenceRule?: Rule }) {
      return api.post("/v1/projects", { body: b })
    },
    async patchProject(p: { id: string; version: number }, b: { name?: string; teamId?: string | null; leadId?: string | null; description?: string; due?: string | null; defaultEvidenceRule?: Rule }) {
      return api.patch("/v1/projects/{id}", { path: { id: p.id }, body: { version: p.version, ...b } })
    },
    async deleteProject(id: string) {
      await api.delete("/v1/projects/{id}", { path: { id } })
    },
    async addMilestone(projectId: string, b: { name: string; due: string }) {
      return api.post("/v1/projects/{id}/milestones", { path: { id: projectId }, body: b })
    },
    async patchMilestone(projectId: string, milestoneId: string, b: { name?: string; due?: string }) {
      return api.patch("/v1/projects/{id}/milestones/{milestoneId}", { path: { id: projectId, milestoneId }, body: b })
    },
    async deleteMilestone(projectId: string, milestoneId: string) {
      await api.delete("/v1/projects/{id}/milestones/{milestoneId}", { path: { id: projectId, milestoneId } })
    },
    async createTemplate(b: { name: string; title: string; description: string; teamId?: string | null; assignee?: string | null; priority: 1 | 2 | 3; tags: string[]; evidenceRule?: EvidenceRule; dueOffset: number; dueTime: string }) {
      return api.post("/v1/task-templates", { body: b })
    },
    async deleteTemplate(id: string) {
      await api.delete("/v1/task-templates/{id}", { path: { id } })
    },
  }
}

/** 409 knock_on_changed: the dependants moved while the manager looked at the preview, so the preview is shown again and nothing was applied (D20). */
export const isKnockOnChanged = (e: unknown): boolean => classifyApiError(e).code === "knock_on_changed"
