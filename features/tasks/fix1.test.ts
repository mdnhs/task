import { readFileSync } from "node:fs"
import path from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test, vi } from "vitest"
import { ApiError, userMessage } from "@/lib/api/problem"
import { toTask } from "./adapters"
import { EMPTY_FILTERS, boardQuery, departmentFilter, listQuery } from "./filters"
import { canOpenEvidence, evidencePath, openEvidence } from "./client"
import { dto } from "@/test/support/task-dto"

vi.mock("server-only", () => ({}))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }), headers: async () => new Headers() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }), usePathname: () => "/tasks", useSearchParams: () => new URLSearchParams() }))

const read = (p: string) => readFileSync(path.join(__dirname, "../..", p), "utf8")
const TID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
const item = (over: Record<string, unknown> = {}) => ({ id: "e1", kind: "photo", name: "a.jpg", by: "Ann", at: "2026-10-24T10:00:00", review: "pending", round: 1, locked: true, fileId: "f1", fileStatus: "clean", ...over })
const problemRes = (status: number, code: string) => new Response(JSON.stringify({ status, code, requestId: "r1" }), { status })

describe("N1: evidence files can be opened, never cached", () => {
  const nonces = (() => { let n = 0; return () => `n${++n}` })()
  test("every open builds a fresh nonce path on our origin: a probe, then a second fresh path in a new tab", async () => {
    const opened: string[] = []
    const fetched: string[] = []
    const f = (async (u: string) => (fetched.push(u), { type: "opaqueredirect", status: 0, ok: false })) as never
    const o = { fetch: f, open: (u: string) => void opened.push(u), nonce: nonces }
    await openEvidence(TID, "e1", o)
    await openEvidence(TID, "e1", o)
    expect(new Set([...fetched, ...opened]).size).toBe(4) // four different paths, none reused
    for (const u of [...fetched, ...opened]) expect(u).toMatch(new RegExp(`^/v1/tasks/${TID}/evidence/e1/download\\?o=n\\d+$`))
    expect(evidencePath(TID, "e1", "x")).not.toMatch(/X-Amz|token|signature/i)
  })
  test("409 file_not_ready, 410 file_infected and 404 show short copy and open nothing", async () => {
    for (const [s, code, text] of [[409, "file_not_ready", "That file is still being scanned."], [410, "file_infected", "That file failed the malware scan."], [404, "evidence_not_found", "That file is not available."]] as const) {
      const open = vi.fn()
      const r = await openEvidence(TID, "e1", { fetch: (async () => problemRes(s, code)) as never, open, nonce: nonces })
      expect(r.ok).toBe(false)
      expect(open).not.toHaveBeenCalled()
      expect(userMessage((r as { error: ApiError }).error).text).toBe(text)
    }
  })
  test("pending, infected and removed items fire no request: they cannot be opened and have no thumbnail", () => {
    expect(canOpenEvidence({ fileId: "f", fileStatus: "clean" })).toBe(true)
    for (const s of ["pending", "infected", "deleted", undefined]) expect(canOpenEvidence({ fileId: "f", fileStatus: s })).toBe(false)
    expect(canOpenEvidence({ fileStatus: "clean" })).toBe(false) // a note or Drive link
    const src = read("features/tasks/components/evidence-panel.tsx")
    expect(src).toMatch(/canOpenEvidence\(e\) && \(e\.kind === "photo"/)
    expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/)
  })
  test("the path is never rendered into server HTML (the thumbnail sets it after mount)", async () => {
    const { EvidencePanel } = await import("./components/evidence-panel")
    const t = toTask(dto({ evidence: [item()], status: "submitted" }))
    const html = renderToStaticMarkup(createElement(EvidencePanel, { task: t, people: [], me: "Me", viewer: { id: "u", name: "Me", manager: true }, canAdd: false, canVerify: true, canEditRule: false, driveAllowed: true, today: "2026-11-18T09:00:00", tzLabel: "GMT", adds: {} as never, onRemove: async () => true, onReview: async () => true, onRule: async () => true }))
    expect(html).not.toMatch(/\/download/)
    expect(html).toMatch(/>Open</)
    const pending = renderToStaticMarkup(createElement(EvidencePanel, { task: toTask(dto({ evidence: [item({ fileStatus: "pending" })], status: "submitted" })), people: [], me: "Me", viewer: { id: "u", name: "Me", manager: true }, canAdd: false, canVerify: false, canEditRule: false, driveAllowed: true, today: "2026-11-18T09:00:00", tzLabel: "GMT", adds: {} as never, onRemove: async () => true, onReview: async () => true, onRule: async () => true }))
    expect(pending).not.toMatch(/>Open</)
  })
})

describe("N2: Waiting on and Blocks from the DTO", () => {
  const dep = (ref: string, status: string) => ({ id: `id-${ref}`, ref, title: `T ${ref}`, status })
  const base = { taskRef: "TSK-1", people: [], today: "2026-11-18T09:00:00", tzLabel: "GMT", actor: "reviewer" as const, canEdit: true, viewer: { id: "u", name: "Me", manager: true, purge: false }, driveAllowed: true }
  test("the adapter maps the new fields with no undefined and throws when they are missing", () => {
    const t = toTask(dto({ dependsOn: ["TSK-5"], dependsOnIds: ["id-TSK-5"], dependencies: [dep("TSK-5", "in_progress")], hiddenDependencies: 2, blocks: [dep("TSK-9", "not_started")], hiddenBlocks: 1 }))
    expect(t).toMatchObject({ dependencies: [{ ref: "TSK-5", status: "in_progress" }], hiddenDependencies: 2, blocks: [{ ref: "TSK-9" }], hiddenBlocks: 1 })
    const d = dto() as Record<string, unknown>
    delete d.hiddenBlocks
    expect(() => toTask(d)).toThrow(/hiddenBlocks/)
  })
  test("the detail shows 'Waiting on' (open ones only), 'Blocks' and the hidden counts, and no ref for hidden ones", async () => {
    const { TaskDetail } = await import("./components/task-detail")
    const t = toTask(dto({ status: "not_started", dependsOn: ["TSK-5", "TSK-6"], dependsOnIds: ["a", "b"], dependencies: [dep("TSK-5", "in_progress"), dep("TSK-6", "completed")], hiddenDependencies: 2, blocks: [dep("TSK-9", "not_started")], hiddenBlocks: 3 }))
    const html = renderToStaticMarkup(createElement(TaskDetail, { ...base, task: t }))
    expect(html).toMatch(/Waiting on TSK-5 to finish/)
    expect(html).not.toMatch(/Waiting on TSK-5, TSK-6/)
    expect(html).toMatch(/Blocks/)
    expect(html).toMatch(/\+2 not shown/)
    expect(html).toMatch(/\+3 not shown/)
  })
})

describe("N3 -> B7 T10: the department filter is the API's (teamId), Load more keeps it", () => {
  test("no rows and no cursor: the plain empty state, no 'loaded so far' hint", async () => {
    const { TasksView } = await import("./components/tasks-view")
    const html = renderToStaticMarkup(createElement(TasksView, { tasks: [], nextCursor: null, people: [], today: "2026-11-18T09:00:00", tzLabel: "GMT", canCreate: true, staff: false }))
    expect(html).toMatch(/No tasks match/)
    expect(html).not.toMatch(/Load more|loaded so far/)
  })
  test("the team filter sends teamId and Load more keeps the filter", () => {
    expect(listQuery({ ...EMPTY_FILTERS, status: "open" }, "team-1")).toEqual({ teamId: "team-1", status: "open" })
    expect(listQuery(EMPTY_FILTERS)).toEqual({})
    const src = read("features/tasks/components/tasks-view.tsx")
    expect(src).toMatch(/\{ \.\.\.listQuery\(filters, teamId\), limit: TASKS_PAGE_SIZE, cursor \}/)
    expect(src).toMatch(/listQuery\(filters, teamId\), limit: TASKS_PAGE_SIZE \}/)
    expect(src).not.toMatch(/t\.dept === dept/)
  })
  test("the department becomes a team id; a name no team has is 'unknown' (shows nothing), never everything", () => {
    const deps = [{ id: "t1", name: "Kitchen" }, { id: "t2", name: "Front of house" }]
    expect(departmentFilter("all", deps)).toEqual({ unknown: false })
    expect(departmentFilter("Kitchen", deps)).toEqual({ teamId: "t1", unknown: false })
    expect(departmentFilter("Garden", deps)).toEqual({ unknown: true })
    expect(departmentFilter("Kitchen", [])).toEqual({ unknown: true })
  })
  test("the board sends the same teamId as the list, and a column's Load more keeps it", () => {
    const f = { project: "all", assignee: "u1", q: " x " }
    expect(boardQuery(f, "t1")).toEqual({ assignee: "u1", q: "x", teamId: "t1" })
    expect(boardQuery({ project: "all", assignee: "all", q: "" })).toEqual({})
    const src = read("features/tasks/components/task-board.tsx")
    expect(src).toMatch(/\.\.\.boardQuery\(f, teamId\) \}/)
    expect(src).not.toMatch(/t\.dept === dept|loaded so far/)
    expect(read("app/(app)/tasks/board/page.tsx")).toMatch(/departments=\{departments\}/)
  })
})

describe("minors: board toast, voice player errors, board extra cards", () => {
  test("the board toast names the status the API answered with", () => {
    const src = read("features/tasks/components/task-board.tsx")
    expect(src).toMatch(/success: \(v\) => `\$\{ref\}: \$\{STATUS\[\(v as \{ status\?: TaskStatus \}\)\.status \?\? to\]\.label\}`/)
    expect(src).not.toMatch(/if \(ok\) toast\.success/)
    expect(read("features/tasks/use-task-writes.ts")).toMatch(/typeof o\.success === "function"/)
  })
  test("a voice player failure reads the API's answer and shows its copy", () => {
    expect(read("features/tasks/components/voice-card.tsx")).toMatch(/onFail=\{\(p\) => void explain\(p\)\}/)
    expect(read("components/voice-note.tsx")).toMatch(/onFail\?\.\(tried\)/)
    expect(userMessage(new ApiError(409, "file_not_ready", "r")).text).toMatch(/scanned/)
  })
  test("board 'Load more' cards are part of the overlay's list", () => {
    expect(read("features/tasks/components/task-board.tsx")).toMatch(/useTaskWrites\(server\)/)
    expect(read("features/tasks/components/task-board.tsx")).toMatch(/\.\.\.Object\.values\(extra\)/)
  })
})
