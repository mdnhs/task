// A task DTO as the API returns it, for the web unit tests.
export const U = { staff: "usr_staff", mgr: "usr_mgr", co: "usr_co", boss: "usr_boss" }
export const TID = "6f1c0d52-8d3a-4b7e-9c41-2a5b7e90d3f8"
export const RULE = { mode: "required" as const, types: ["photo" as const], min: 1, instruction: "", review: "manager" as const }
export const dto = (over: Record<string, unknown> = {}) => ({
  id: TID, ref: "TSK-1001", version: 3, title: "Check fire exits", description: "Walk every floor.", dept: "Cleaning", teamId: null, assignee: U.staff, assignees: [U.co], creator: U.boss,
  priority: 2, start: "2026-10-24T09:00:00", due: "2026-10-25T01:30:00", startAt: "2026-10-24T08:00:00.000Z", dueAt: "2026-10-25T00:30:00.000Z", status: "submitted", evidenceRule: RULE,
  tags: ["safety"], parentId: null, checklist: [], subtasks: [], dependsOn: [], dependsOnIds: [], dependencies: [], hiddenDependencies: 0, blocks: [], hiddenBlocks: 0, round: 1, notes: [], evidence: [], timeline: [], timeEntries: [], evidenceState: "awaiting", voiceNote: null,
  seriesId: "9a2b7c14-5e60-4d38-8f21-0c6d4e1b7a93", ...over,
})
export const ev = (over: Record<string, unknown> = {}) => ({ id: "e1", kind: "photo", name: "a.jpg", by: "Ann", at: "2026-10-24T10:00:00", review: "pending", round: 1, locked: true, fileId: "f1", fileStatus: "clean", ...over })

