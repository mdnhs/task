# Backend B4: M1 Tasks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the M1 task module from the real API: tasks with assignees, labels, checklists, subtasks, comments and a field-level history; projects, milestones and finish-to-start dependencies with a knock-on preview; recurring tasks and templates as scheduled jobs; a 30-day archive with an audited purge; board and calendar queries; evidence rules, evidence items and reviews; and voice instructions. Every rule the front end already runs (`features/tasks/*`, `@opsdesk/domain/task-*`) is ported, not rewritten.

**Architecture:** One module `api/src/modules/tasks/` (routes, service, repo, scope, history, events, jobs) plus `modules/projects/` and `modules/task-evidence/`, all behind `requireTenant → requireModule("M1") → requirePermission("tasks", …)`. Tables follow the R8 RLS template and the composite `(tenant_id, …)` FK pattern from `teams.ts`, so a row can never point into another tenant. Times are stored as UTC `timestamptz`; the API speaks tenant-local wall clock (the FE contract) and converts with `wallToEpoch` / `epochToWall` from `@opsdesk/domain/shifts`. Pure rules move from `features/tasks/{lifecycle,planning,recurrence,templates}.ts` into `packages/domain/src/task-*.ts`; the feature files re-export them, so FE tests stay green. Files reuse the B2 upload pipeline through a task-scoped intent (no M4 or `files:write` needed). Changes publish ids-only domain events (outbox, same tx); search indexes tasks through a bus subscriber.

**Tech Stack:** existing stack (Hono + zod-openapi, Drizzle, Postgres 16 forced RLS, BullMQ via `registerJob` / `upsertJobScheduler`, R2 storage + ClamAV, Vitest + Testcontainers). No new dependencies.

**Spec:** `.claude/docs/requirements/SRS.md` §5.2 (FR-M1-01..05, 10..14, 40..49), §5.4 (AC-M1-04, 05, 06, 08), Appendix A.1 (Q6, Q8, Q10) and A.2 (task voice change request, 30 Oct 2026); `.claude/docs/features/tasks.md`; `SRS-v1.2-built.md` for FR-TASK-* ids in FE comments; roadmap B4; follow-ups `2026-11-16-backend-b0-b1-followups.md` (R5, R8, R9, R23–R27), `2026-11-17-backend-b2-followups.md` (B1–B16), `2026-11-17-backend-b3-followups.md` (C4, C7, C13, C14 and "add a shared `subjectUserId(c)` before B4"). **Depends on B1–B3** (RBAC, teams, audit, events, notifications, files, search, entitlements, API keys).

## Rulings (made for B4; binding for B5/B6)

| ID | Ruling | Why | Cost if wrong |
|---|---|---|---|
| D1 | The plan has 7 tasks; roadmap T4.1 splits into T4.1 (core) and T4.2 (collaboration). Roadmap T4.2–T4.6 become T4.3–T4.7. | One review per concern; T4.1 alone would be too large. | none |
| D2 | Path params are task **uuids** (`{id}`). `ref` (`TSK-<n>`, per-tenant counter) is display and filter only (`GET /v1/tasks?ref=`). DTOs carry both: `parentRef`/`dependsOn` (refs, FE contract) and `parentId`/`dependsOnIds` (ids). Writes take ids. | Refs repeat across tenants, so the isolation walker could not get a 404 for B's ref. | B6 adapter maps ids for writes |
| D3 | `start_at`/`due_at` are UTC `timestamptz`. The API accepts and returns tenant-local wall clock `YYYY-MM-DDTHH:mm:ss` (`start`, `due`) plus UTC (`startAt`, `dueAt`). Gap times move forward; ambiguous times take the earlier instant (`wallToEpoch`). Project and milestone due dates are `date` (tenant-local calendar day). Timezone from `c.var.tenant.timezone`, never hard-coded. | Matches the FE contract and the shift rules. A tenant timezone change needs no data migration. | a tenant that changes its timezone sees existing tasks at new local times (correct instants) |
| D4 | Lost-update guard = integer **`version`** in the JSON body of every task mutation that changes task fields or status (PATCH, assignees, status, complete, verify, reject, reschedule, dependencies, repeat, evidence rule, archive). Mismatch → **409 `version_conflict`**. Child rows (checklist items, comments, evidence items) do not bump `version`. Checklist PATCH sets `done` absolutely (no toggle). | Works with the typed RPC client and the R5 body examples; ETag/If-Match would need header plumbing in the walker and in `hc`. | a client that skips `version` gets 422 (field required) |
| D5 | Task scope, from `taskScope(role, me)` in `@opsdesk/domain/task-scope`: staff-home → **own** (assignee, co-assignee, creator or named reviewer); manager-home with template `reportScope: "team"` (following `cloned_from` as in `peopleAccess`) → **team** (own, plus tasks with an assignee who reports to me); other manager-home → **all**. Out of scope → **404 `task_not_found`** (no existence oracle). "Me" = `subjectUserId(c)` (the creator for API keys). | FR-M1-10, the FE seed filter (`isAssigned`), and the B3 follow-up. | a team manager cannot see tasks of indirect reports (one level only, same as reports) |
| D6 | Manager authority over a task (`canManage`) = manager-home role + `tasks:write` + task in its team/all scope. Only managers change dates, assignees, project/milestone, archive and restore (Q8). Staff with `tasks:write` may create tasks for **themselves only** (403 `cannot_assign_others`), move their assigned tasks through the lifecycle, attach evidence, comment, tick checklists, propose dates, and edit title, description, priority, labels and checklist text of tasks **they created**. | SRS A.1 Q8 assumption and the FE `new-task` rules. | members can't fix their own typo in a manager-created task |
| D7 | Every change writes `task_history` (old/new per field). The tamper-evident **audit** log (FR-M0-13) gets only archive, restore, purge (manual and retention), evidence verify/reject, and project/template delete. | The audit lock serialises writers per tenant; auditing every edit would break the p95 target. FR-M0-13 lists deletions and admin actions. | an auditor reads routine edits from task history, not from `/v1/audit` |
| D8 | **Verifier independence:** nobody verifies or rejects an evidence item they uploaded, or evidence on a task where they are any assignee. This applies to managers too (403 `self_verification`). `canVerify` in the domain gains the co-assignee check. API keys cannot verify, reject or purge (403 `human_required`). | Review Focus #3. Verification is a personal attestation. | a manager assigned to their own task needs a second manager to verify it |
| D9 | Task files (evidence, comment attachments, voice) use a **task-scoped upload intent** `POST /v1/tasks/{id}/uploads` that calls the B2 pipeline with an `UploadPolicy` (purpose, mime list, max bytes, permission lock). It needs M1 + task access, not M4 + `files:write`. `/v1/files/{id}` and `/download` return 404 `file_not_found` for `purpose LIKE 'task_%'`; those files are reachable only through task routes. | Starter tenants (M1 without M4) must be able to attach proof (B3 follow-up). Files must follow task access. | two download paths to maintain |
| D10 | An evidence item counts toward the minimum only when its file is `clean`. Complete or submit with any `pending` file → **409 `evidence_not_ready`**. An `infected` file auto-rejects its item (reviewer `system:scanner`, reason "Failed malware scan"). Notes, checklist snapshots and Drive links have no file and count immediately. | FR-M1-46/47: every file is malware-scanned before anyone relies on it. | the assignee waits a few seconds after an upload before pressing Complete |
| D11 | Recurrence supports the FE rule set (`daily`, `weekdays`, `weekly` with days, `monthly` with dayOfMonth, optional `until`). **"Per shift" is B5** (T5.1 adds `freq: "per_shift"`; until then 422 `unsupported_repeat`). "Custom" = weekly with days, or monthly. Instances are created by a job, up to the tenant-local today, idempotent on `(tenant_id, series_id, occurrence_date)`, using a per-series cursor. Catch-up is at most 7 days back; older missed dates are skipped and logged in the series history. | SRS "per shift" needs shift patterns (B5). The cap stops a re-enabled module from flooding a member with weeks of stale instances. | a worker outage longer than 7 days loses those instances (they are logged) |
| D12 | `search_documents` gains `audience text[] null` (GIN). Task docs set audience = assignees ∪ creator ∪ named reviewer. `searchDocuments` takes an optional per-module scope: own → `audience && {me}`; team → `audience && ({me} ∪ directReports(me))`; all → no filter. Archived tasks are removed from the index; restored ones are re-indexed. | Search is module-gated only today, so it would leak titles of other people's tasks to staff (FR-M0-02 spirit). | one migration on the B2 table |
| D13 | Archive cascades to open subtasks (same `archive_batch_id`); restore brings that batch back. Restore only within 30 days of `archived_at` (410 `archive_expired`). Purge (manual: `settings:write`, human, task already archived; retention job: archived ≥ 30 days) hard-deletes the task, its children rows, its dependency edges and its task files (B2 `file.delete-object` job). A voice file still referenced by another task is kept. | FR-M1-13 and the voice note retention note in `features/tasks.md`. | evidence is gone with the task; per-tenant evidence retention lands with the B11 retention policy |
| D14 | Task events are ids-only and **not** added to the B3 webhook `PROJECTION` allow-list in B4. They are shaped so a later phase only has to add projection lines. | The brief: "so the allow-list can add them later". | none |
| D15 | Notifications use a new `NotificationKind` `"task"` (in-app + push on, email off by default). They are written in the request tx with `notify(...)` inside `withTenantAfterCommit`, and the recipients are recorded on the history row's `notified` (FR-M1-12, AC-M1-04). | Same-tx notification makes AC-M1-04 deterministic and matches the B2 pattern. | none |
| D16 | Comments: body ≤ 4000, `mentions` as user ids (≤ 20), up to 5 attachment file ids from the task upload intent. No edit. Authors delete their own comments (soft). Managers can delete any comment in scope. A mentioned user who cannot see the task gets no notification, and the request still returns 201 (no oracle). | FR-M1-03 with the smallest safe surface. | no comment editing (FE has none) |
| D17 | Labels are free text: trimmed, lower-cased, deduped, ≤ 10 per task, each 1–32 chars, `text[]` with GIN index. `dept` maps to `team_id` (a team of kind `department`); the DTO `dept` is that team's name. | FE labels are free text; departments are teams (SRS A.5). | none |
| D18 | Out of B4: custom statuses and approval steps (FR-M1-06, Should), time tracking UI and timesheets (FR-M1-07, Should; `task_time_entries` is created here for B5), goals (FR-M1-08, Could), timeline and workload views (FR-M1-05 Should; the list endpoint already returns start and due). | Phase 1 Must scope; Appendix A marks them not built. | a later phase adds endpoints, not tables |
| D19 | Evidence limits come from env per deployment: `TASK_EVIDENCE_MAX_BYTES` (default 25 MiB, `MAX_FILE_BYTES`), `TASK_VIDEO_MAX_BYTES` (default 100 MiB, `MAX_VIDEO_BYTES`), `TASK_VOICE_MAX_BYTES` (default 3 MiB). Per-tenant limits wait for B11. Location is never accepted (no field; Q6). Capture metadata = client `capturedAt` + `source` (camera/upload) + server-side `device_id` from `c.var.device`. | FR-M1-46 "configurable" with no tenant UI yet. | per-tenant limits wait for B11 |
| D20 | Knock-on: `reschedule/preview` returns `{ moves, previewHash }` (sha256 of the sorted moves plus the versions of the moved tasks). Apply sends `knockOn: { apply: true, previewHash }`. If the graph or a version changed → 409 `knock_on_changed`. If a move targets a task outside the actor's manage scope → 409 `knock_on_out_of_scope` (the preview flags it `outOfScope: true`). With `apply: false`, only the task moves. | FR-M1-14 "show before saving": what is saved must be what was shown. | one extra round trip after a concurrent edit |
| D21 | Voice note: one per task. Upload purpose `task_voice`, mime `audio/webm`, `audio/mp4` or `audio/ogg` (codec parameters stripped for this purpose only), declared `durationSec` 1–120 (422 `voice_too_long`), size ≤ `TASK_VOICE_MAX_BYTES`. Set by the task creator or a manager. Played by anyone who can see the task via a 60 s presigned GET. Each play is logged in `task_voice_access`. Recurring instances share the series file id. Templates never copy it. Never sent to an AI or transcription provider. | Change request 30 Oct 2026 and its privacy note. | duration is the client's claim; the size cap is the server-side bound |
| D22 | Drive links: when `driveAllowed(c)` is false, every task response passes through `withholdDriveLinks` (evidence) and a new `withholdDriveText` (description, comment bodies: each `isDriveUrl` match becomes "Google Drive link"). Attaching a `drive` evidence item requires `driveAllowed` (403 `device_policy`). Checked on every request (FR-M0-10). | AC-M1-06 and Review Focus #3 of the roadmap. | none |
| D23 | Default evidence rules (FR-M1-42): new task rule = explicit body rule → template rule (`templateId`) → project `default_evidence_rule` → `NO_EVIDENCE`. Instances copy the series rule. The creator may always override (there is no "locked" flag). | Should-level FR; the FE has no lock. | admins cannot force a rule yet |
| D24 | Subtasks are one level deep (422 `subtask_depth`), so there are no parent cycles. Creating a subtask copies team, assignee, project and due date from the parent, with no evidence by default (`makeSubtask`). | FE model. | none |

## Global Constraints

- All B2/B3 global constraints apply: cross-tenant ids → **404** (never 403); errors are problem+json `{type,title,status,code,requestId}`; semantic errors **422**; R8 RLS template on every tenant table (`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`, USING and WITH CHECK, FORCE appended in the migration); RLS-denial assertions read `.cause` (R9); every JSON body declares `.openapi({ example })` (R5); every new path-param route gets `ROUTE_PARAMS` + `SPECS` entries (B4 ruling of B2); `deps.clock` only, never `new Date()`; no secrets or file names in logs.
- `requireModule("M1")` on every task, project, template and evidence route: removing M1 → 403 `module_not_entitled` within 60 s, data untouched, and re-enabling restores it. Jobs skip tenants without M1 or with status `suspended` (C14) and keep their data.
- Lock order inside a mutation tx: namespaced advisory locks first (`TASK_GRAPH_LOCK_NS` for dependency edits, `TASK_COUNTER` row update for refs) → `lockActor` (R25, FOR SHARE; API keys go through `lockApiKeyActor`) → task row `FOR UPDATE` → writes → history → `notify` → `recordAudit` → `publish` last (B7 lock order rule). Audit is written in the same tx as the change.
- Principal: API keys (C7) act with scopes ∩ the creator's current role. Data scope comes from `subjectUserId(c)` (the creator). History and audit actor is `actorIdOf(c)` (`apikey:<id>` for keys). C13 adds no exemptions for tasks (tasks writes are blocked with 402 while the tenant is blocked).
- Lists use cursor pagination: `?limit` (1–100, default 25) and `?cursor` (base64url of the sort key + id, as in billing). A bad cursor → 400 `invalid_cursor`. The response is `{ items, nextCursor }`.
- p95 < 500 ms at 250 users/tenant, 10 000 live tasks: each list query must use a named index (EXPLAIN test per task).
- History stores raw old and new values per field (`{ field, from, to }`: UTC ISO for dates, ids for people). The DTO adds display strings formatted in tenant time with current names (erased people show as "Former member"; names are never snapshotted).
- DST: every due-date and recurrence computation runs on tenant-local wall clock. Tests cross the last Sunday of October (25 Oct 2026) in `Europe/Dublin` and the last Sunday of March (28 Mar 2027).

## Review Focus

1. **Recurrence fires twice or skips a day over DST** — a daily series due 01:30 local, with the job running every 15 min through 24–26 Oct 2026 in Europe/Dublin (01:30 happens twice on the 25th), and two workers running at once. Expected: exactly one instance per local date, none skipped, due at the earlier 01:30. Test: T4.4 `recurrence creates exactly one instance per local date across the October DST change, even with two concurrent runs`.
2. **Dependency cycle through concurrent edits** — request 1 makes A depend on B while request 2 makes B depend on A. Expected: one succeeds, the other 422 `dependency_cycle`; the graph stays acyclic. Test: T4.3 `concurrent opposite dependency edits cannot form a cycle`.
3. **Reviewer verifies their own evidence** — a manager who is a co-assignee, the uploader, or an API key tries to verify. Expected: 403 `self_verification` / `human_required`; nothing changes. Test: T4.6 `nobody verifies evidence they uploaded or on a task they are assigned to; keys cannot verify`.
4. **Archived task leaks** — an archived task shows up in search, board, calendar, list, a knock-on preview or `applyTaskUpdate`. Expected: absent everywhere except `/v1/tasks/archive`, and restore brings it back. Test: T4.5 `archived tasks are excluded from list, board, calendar, search and knock-on, and return on restore`.
5. **Lost updates** — two managers PATCH the same task at the same version; two members tick different checklist items at once. Expected: one PATCH 200, the other 409 `version_conflict`; both checklist ticks persist. Tests: T4.1 `concurrent PATCH with the same version: one wins, one 409`, T4.2 `concurrent checklist ticks on different items both persist`.

---

## File structure

```
packages/domain/src/
  task-model.ts            # TaskStatus, RepeatRule, ChecklistItem, DateProposal, Milestone, Project, TaskTemplate, FieldChange (moved from features/tasks/types.ts)
  task-lifecycle.ts        # from features/tasks/lifecycle.ts (isOpen, nextStatuses, boardMove, isLate)
  task-planning.ts         # from features/tasks/planning.ts (wouldCycle, knockOn, dependantsOf, archive helpers, progress)
  task-recurrence.ts       # from features/tasks/recurrence.ts (nextOccurrences, repeatError, describeRepeat)
  task-templates.ts        # from features/tasks/templates.ts (applyTemplate, templateFromForm)
  task-scope.ts            # + taskScope(role, me)
  task-evidence.ts         # canVerify: + co-assignee check (D8)
  task-history.ts          # new: diffFields(before, after), formatChange(change, ctx)
  devices.ts               # + withholdDriveText(text)
features/tasks/{lifecycle,planning,recurrence,templates,types}.ts   # re-export from @opsdesk/domain (tests unchanged)
api/src/
  core/middleware/principal.ts        # + subjectUserId(c), actorIdOf(c)
  db/schema/tasks.ts                  # tasks, task_assignees, task_checklist_items, task_dependencies, task_comments, task_history, task_files, task_time_entries, task_counters, task_voice_access
  db/schema/projects.ts               # projects, project_milestones, task_templates
  db/schema/task-evidence.ts          # task_evidence
  db/migrations/0027_tasks.sql … 0033_task_voice.sql
  modules/tasks/{routes,service,repo,scope,history,dto,cursor,events,notify,uploads,collab,planning,recurrence,archive,views,voice,dsr,search,index}.ts
  modules/projects/{routes,service,index}.ts
  modules/task-templates/{routes,service,index}.ts
  modules/task-evidence/{routes,service,review,gallery,index}.ts
  modules/files/service.ts            # UploadPolicy parameter; task_% purposes hidden from /v1/files
  modules/search/{service,subscribers}.ts  # audience column + scoped query
  modules/notifications/prefs.ts      # + "task" kind
  worker.ts                           # registerTasks(): tasks.recurrence (15 min), tasks.archive-purge (hourly)
api/test/{route-fixtures.ts,isolation.test.ts}  # new resources + SPECS
```

## Interfaces locked by this plan

```ts
// core/middleware/principal.ts (B3 follow-up, done in T4.1; /v1/people is switched to it)
subjectUserId(c: Context<AppEnv>): string       // apiKey?.creatorId ?? member.userId  — whose data "me" means
actorIdOf(c: Context<AppEnv>): string           // apiKey ? `apikey:<id>` : member.userId — who did it (history, audit)

// @opsdesk/domain/task-scope
type TaskScope = { kind: "all" } | { kind: "team"; managerId: string } | { kind: "own"; personId: string }
taskScope(role: Role & { reportScope?: "team" }, meId: string): TaskScope | null      // null = no tasks:read

// modules/tasks (exported for B5 shift reports and the Today card)
type TaskCtx = { tenantId: string; tz: string; me: string; actorId: string; role: ResolvedRole; scope: TaskScope; drive: boolean; now: Date }
loadTaskCtx(c: Context<AppEnv>, tx: TenantTx): Promise<TaskCtx>
taskScopeWhere(scope: TaskScope, reports: string[]): SQL                               // predicate on tasks t
getTask(tx: TenantTx, ctx: TaskCtx, id: string, o?: { forUpdate?: boolean; includeArchived?: boolean }): Promise<TaskRow>   // 404 task_not_found
canManage(ctx: TaskCtx, task: TaskRow, assignees: string[]): boolean               // D6: manager-home + tasks:write + task in team/all scope
applyTaskUpdate(tx: TenantTx, ctx: TaskCtx, u: TaskUpdate /* @opsdesk/domain/contracts */): Promise<"applied" | "duplicate" | "skipped_archived">
listTasksForPerson(tx: TenantTx, tenantId: string, personId: string, window: { fromUtc: Date; toUtc: Date }): Promise<TaskCard[]>  // B5 report rows
type TaskDto = FeTask /* features/tasks/types.ts Task */ & { id: string; version: number; startAt: string; dueAt: string; parentId: string | null; dependsOnIds: string[]; evidenceState: EvidenceState | null; voiceNote: { durationSec: number; mime: string; recordedBy: string; recordedAt: string } | null }

// files (B2) — extended in T4.2
type UploadPolicy = { purpose: "task_evidence" | "task_attachment" | "task_voice"; mimes: readonly string[]; maxBytes: (mime: string) => number; lock: (tx: TenantTx) => Promise<void>; stripMimeParams?: boolean }
createUpload(deps, tenantId, actor, input, policy?: UploadPolicy): Promise<{ fileId: string; upload: PresignedPut }>
completeUpload(deps, tenantId, actor, id, policy?: UploadPolicy): Promise<FileDto>

// search (B2) — extended in T4.2
indexDocument(tx, doc: SearchDoc & { audience?: string[] | null }, now)
searchDocuments(tx, tenantId, modules, rawQ, limit, scopes?: Partial<Record<Module, { audience: string[] } | null>>)

// events (core/events/types.ts EventType additions; payloads ids-only, D14)
"task.created"          { taskId, parentId|null, projectId|null, seriesId|null }
"task.updated"          { taskId, historyId, fields: string[] }          // field names only
"task.assigned"         { taskId, added: string[], removed: string[] }   // user ids
"task.status_changed"   { taskId, from: TaskStatus, to: TaskStatus }
"task.completed"        { taskId }
"task.submitted"        { taskId, round }
"task.evidence_added"   { taskId, evidenceId }
"task.evidence_verified"{ taskId, evidenceIds: string[] }
"task.evidence_rejected"{ taskId, evidenceIds: string[], round }
"task.comment_added"    { taskId, commentId }
"task.archived" | "task.restored" | "task.purged"  { taskId }
"project.created" | "project.updated" | "project.deleted"  { projectId }
```

### Error codes (all problem+json)

404: `task_not_found`, `comment_not_found`, `checklist_item_not_found`, `evidence_not_found`, `project_not_found`, `milestone_not_found`, `template_not_found`, `file_not_found`, `voice_note_not_found` · 403: `module_not_entitled`, `forbidden`, `cannot_assign_others`, `dates_manager_only`, `not_a_reviewer`, `self_verification`, `human_required`, `device_policy` · 409: `version_conflict`, `task_archived`, `task_not_archived`, `evidence_not_ready`, `evidence_locked`, `knock_on_changed`, `knock_on_out_of_scope` · 409/410 (B2 files): `file_not_ready`, `file_infected` · 410: `archive_expired` · 422: `invalid_dates`, `invalid_assignee`, `invalid_milestone`, `invalid_range`, `invalid_transition`, `invalid_team`, `invalid_labels`, `evidence_required`, `invalid_evidence_rule`, `invalid_reviewer`, `evidence_type_not_allowed`, `dependency_cycle`, `invalid_dependency`, `subtask_depth`, `checklist_limit`, `invalid_repeat`, `unsupported_repeat`, `voice_too_long`, `mime_not_allowed`, `file_too_large`, `upload_mismatch` · 400: `invalid_cursor`. Body ids from another tenant are reported exactly as non-existent ids (422 `invalid_*`, never a different code).

---

### Task T4.1: Principal helper, task core, scope, history, optimistic version

**Files:**
- `core/middleware/principal.ts` (+`subjectUserId`, `actorIdOf`); `modules/teams/routes.ts` (people route uses `subjectUserId`).
- Domain: `task-model.ts`, `task-lifecycle.ts`, `task-history.ts`, `task-scope.ts` (`taskScope`), `devices.ts` (`withholdDriveText`). FE files re-export.
- `db/schema/tasks.ts` + migration `0027_tasks.sql`:
  - `task_counters(tenant_id pk, next_no int not null default 1000)`.
  - `tasks(id uuid pk, tenant_id, ref_no int, title text 1..200, description text ≤ 10000, team_id uuid null, creator_id text null, priority smallint 1..3, start_at timestamptz, due_at timestamptz, status text check in 7 statuses, labels text[] default '{}', estimate_min int null, client text null, project_id uuid null, milestone_id uuid null, parent_id uuid null, evidence_rule jsonb not null, round int default 1, repeat jsonb null, series_id uuid null, occurrence_date date null, repeat_cursor date null, proposal jsonb null, overdue_plan jsonb null, voice_file_id uuid null, voice_meta jsonb null, submitted_at, completed_at, archived_at, archived_by text, archive_batch_id uuid null, version int not null default 1, created_at, updated_at)`.
  - Constraints: `unique(tenant_id, ref_no)`; `unique(tenant_id, id)`; `check(start_at <= due_at)`; composite FKs `(tenant_id, creator_id)` → memberships (no cascade; `creator_id` is nulled on erasure), `(tenant_id, team_id)` → teams, `(tenant_id, parent_id)` → tasks.
  - `task_assignees(tenant_id, task_id, user_id, is_primary bool, pk(task_id, user_id))`: FK `(tenant_id, task_id)` → tasks on delete cascade, FK `(tenant_id, user_id)` → memberships; partial unique `(task_id) where is_primary`.
  - `task_history(id uuid pk, tenant_id, task_id, at, actor_id text null, kind text, text text null, changes jsonb not null default '[]', notified text[] default '{}', update_id text null)`: `unique(tenant_id, task_id, update_id)`.
  - `task_time_entries(id, tenant_id, task_id, user_id, minutes int > 0, note, source, update_id text not null, at)`: `unique(tenant_id, update_id)`.
  - Indexes: `tasks_live_due_idx (tenant_id, due_at, id) where archived_at is null`, `tasks_live_status_due_idx (tenant_id, status, due_at, id) where archived_at is null`, `tasks_labels_gin (labels)`, `tasks_title_trgm_idx gin(lower(title) gin_trgm_ops)`, `task_assignees_user_idx (tenant_id, user_id, task_id)`, `task_history_task_idx (tenant_id, task_id, at desc, id desc)`.
  - All tables use the R8 policy + FORCE.
- `modules/tasks/{routes,service,repo,scope,history,dto,cursor,events,notify,dsr,index}.ts`; `modules/notifications/prefs.ts` (+`task`); `core/events/types.ts` (+task event types).

**Interfaces:** All routes have `requireTenant, requireModule("M1")`.

| Method + path | Permission | Notes |
|---|---|---|
| `GET /v1/tasks` | `tasks:read` | filters `status` (`all\|open\|review\|<status>`), `due` (`all\|today\|overdue\|week`, tenant-local), `priority`, `assignee`, `project`, `repeat`, `q` (ref or title, trigram), `ref`, `label`; cursor sort `(due_at, id)`; scope-filtered; archived excluded |
| `POST /v1/tasks` | `tasks:write` | 201 TaskDto; ref from `task_counters` (`UPDATE … RETURNING`) |
| `GET /v1/tasks/{id}` | `tasks:read` | TaskDto (checklist, subtasks, dependencies, last 50 history rows) |
| `PATCH /v1/tasks/{id}` | `tasks:write` | `{ version, title?, description?, priority?, labels?, estimateMin?, client?, teamId?, start?, due?, overduePlan? }`; dates manager-only (403 `dates_manager_only`) |
| `PUT /v1/tasks/{id}/assignees` | `tasks:write` + manage | `{ version, primary, others[] ≤ 9 }` |
| `POST /v1/tasks/{id}/status` | `tasks:write` | `{ version, to }` via `nextStatuses` (assignee) or reviewer `cancelled`; 422 `invalid_transition` |
| `POST /v1/tasks/{id}/complete` | `tasks:write` | `{ version }` → `completeTarget` (evidence items are `[]` until T4.6) |
| `GET /v1/tasks/{id}/history` | `tasks:read` | cursor `(at desc, id desc)` |

Also exported: `applyTaskUpdate` (B5 shift reports and the Today card; idempotent on `update_id`; writes a history line with `notified=[]` and one `task_time_entries` row when `minutes > 0`; `itemStatus: "done"` goes through `completeTarget`, so a Required task without evidence stays open and gets the line "Report marked done; evidence still needed").

- [ ] **Step 1: Failing tests** (`modules/tasks/tasks.test.ts`, `packages/domain/src/task-scope.test.ts`, `core/middleware/principal.test.ts`)

```ts
test("subjectUserId is the creator for an api key and the member otherwise; actorIdOf is apikey:<id> for keys", async () => {})
test("/v1/people with an api key created by a team manager lists that manager's team (regression of the B3 follow-up)", async () => {})
test("taskScope: employee → own, manager (reportScope team) → team, ops/owner → all, a role without tasks:read → null; a clone of manager keeps team", () => {})
test("create stores UTC and echoes tenant-local wall clock: due 2026-10-25T01:30:00 Europe/Dublin → dueAt 2026-10-25T00:30:00.000Z (earlier instant)", async () => {
  const r = await post(A.manager, "/v1/tasks", { ...base, start: "2026-10-24T09:00:00", due: "2026-10-25T01:30:00" })
  expect(r.dueAt).toBe("2026-10-25T00:30:00.000Z"); expect(r.due).toBe("2026-10-25T01:30:00")
})
test("due 2027-03-28T01:30:00 (spring-forward gap) is stored as 01:30Z and shown as 02:30 local", async () => {})
test("due=today and due=overdue follow the tenant timezone, not UTC (tenant in Pacific/Auckland at 23:30Z)", async () => {})
test("refs are sequential per tenant and never collide under 20 concurrent creates", async () => {})
test("staff can create only for themselves (403 cannot_assign_others) and cannot PATCH dates (403 dates_manager_only)", async () => {})
test("a manager reschedules and reassigns a member's task: the member is notified and history has old and new values (AC-M1-04)", async () => {
  // history row: changes = [{ field: "due", from: "2026-11-20T17:00:00.000Z", to: "2026-11-21T17:00:00.000Z" }], notified = [member]
  // GET history DTO: { field: "Due", from: "20 Nov 17:00", to: "21 Nov 17:00" }; notification kind "task" exists for member
})
test("concurrent PATCH with the same version: one wins, one 409 version_conflict", async () => {})   // Review Focus #5
test("a task outside the caller's scope is 404 task_not_found on GET, PATCH, status and history (staff, team manager)", async () => {})
test("team manager sees tasks of direct reports, not of other teams; owner sees all", async () => {})
test("assignee from another tenant or an inactive member → 422 invalid_assignee (same code as a random uuid)", async () => {})
test("status moves follow nextStatuses; blocked → completed is 422 invalid_transition; manager may cancel any open task", async () => {})
test("complete on evidence 'none' → completed with completedAt; publishes task.completed { taskId } only", async () => {})
test("api key with tasks:read (staff creator) lists only the creator's tasks; tasks:read cannot POST (403); a write by key is recorded as apikey:<id> in history", async () => {})
test("removing M1 → 403 module_not_entitled within 60 s; rows untouched; re-enable → 200", async () => {})
test("without drive access, Drive URLs in the description come back as 'Google Drive link' on every response; with access they are intact", async () => {})
test("applyTaskUpdate is idempotent by update id, logs time, and never completes a Required task without evidence", async () => {})
test("task events carry ids only (no title, description or names)", async () => {})
test("list uses tasks_live_due_idx (EXPLAIN) and returns 25 items + nextCursor; a bad cursor → 400 invalid_cursor", async () => {})
test("RLS: a tenant-A tx cannot read or insert tenant-B task rows (error on .cause)", async () => {})
```

- [ ] **Step 2:** Run the tests → FAIL.
- [ ] **Step 3:** Implement. Port the domain files with `git mv` + re-export shims, and keep the FE Vitest suites green (`npm test` at the root). Add isolation `ROUTE_PARAMS`/`SPECS` for `/v1/tasks/{id}`, `/assignees`, `/status`, `/complete`, `/history` (expect `task_not_found`, actor `owner`) and the `task` resource in `route-fixtures.ts`. Register the tasks DSR handler: export = tasks the subject created or is assigned to (ids, refs, titles) and history rows they authored; erase = null `creator_id`/`actor_id` and remove assignments of the subject.
- [ ] **Step 4:** Run the tests → PASS (including `isolation.test.ts`, `rls-guard.test.ts`, and the domain and FE suites).
- [ ] **Step 5:** Commit `feat(api): task core with scope, field history and optimistic versions`.

### Task T4.2: Checklists, subtasks, comments, task uploads, search

**Files:**
- Schema + migration `0028_task_collab.sql`:
  - `task_checklist_items(id, tenant_id, task_id, text 1..200, done bool, position int, done_by text null, done_at)`, max 50 per task.
  - `task_comments(id, tenant_id, task_id, author_id text null, body text 1..4000, mentions text[], attachment_file_ids uuid[], created_at, deleted_at)`.
  - `task_files(file_id uuid pk, tenant_id, task_id, purpose text check in ('task_evidence','task_attachment','task_voice'), created_by, created_at)`; FK `(tenant_id, file_id)` → files.
  - `search_documents.audience text[]` + `search_documents_audience_gin`.
  - Indexes: `task_checklist_task_idx`, `task_comments_task_idx (tenant_id, task_id, created_at, id)`, `tasks_parent_idx (tenant_id, parent_id) where parent_id is not null`.
- `modules/tasks/{collab,uploads,search}.ts`; `modules/files/service.ts` (`UploadPolicy`, hide `task_%` purposes); `modules/search/service.ts` (audience).

**Interfaces:**

| Method + path | Permission | Notes |
|---|---|---|
| `POST /v1/tasks/{id}/checklist` | `tasks:write` (assignee or manage or creator) | `{ text }`; 422 `checklist_limit` |
| `PATCH /v1/tasks/{id}/checklist/{itemId}` | `tasks:write` | `{ done?, text? }`; `done` is absolute; text: creator or manager only |
| `DELETE /v1/tasks/{id}/checklist/{itemId}` | `tasks:write` | creator or manager |
| `POST /v1/tasks/{id}/subtasks` | `tasks:write` | `{ title }` → 201 child TaskDto (`makeSubtask`); 422 `subtask_depth` |
| `GET /v1/tasks/{id}/comments` | `tasks:read` | cursor |
| `POST /v1/tasks/{id}/comments` | `tasks:write` | `{ body, mentions?, attachmentFileIds? }` |
| `DELETE /v1/tasks/{id}/comments/{commentId}` | `tasks:write` | author, or a manager of the task |
| `POST /v1/tasks/{id}/uploads` | `tasks:write` | `{ purpose: "evidence"\|"attachment"\|"voice", name, mime, sizeBytes }` → presigned PUT (B2 flow) |
| `POST /v1/tasks/{id}/uploads/{fileId}/complete` | `tasks:write` | idempotent; the scan job is queued |
| `GET /v1/tasks/{id}/files/{fileId}/download` | `tasks:read` | 302 to a 60 s presigned GET; 409 `file_not_ready`, 410 `file_infected` |

Evidence mimes = the B2 list + `video/mp4`, `video/quicktime`, `video/webm`. Attachment mimes = the B2 list. Voice mimes per D21. Search: a subscriber on `task.created|updated|assigned|archived|restored|purged` re-reads the task. It indexes `{ entity: "task", module: "tasks", title: "<ref> <title>", body: labels + first 500 chars of the description (Drive URLs removed), audience }`, and removes the document when the task is archived or gone.

- [ ] **Step 1: Failing tests**

```ts
test("concurrent checklist ticks on different items both persist (no lost update)", async () => {})   // Review Focus #5
test("checklist ticks do not bump task.version; a PATCH at the old version still succeeds", async () => {})
test("subtask copies team, assignee, project and due; a subtask of a subtask → 422 subtask_depth", async () => {})
test("comment with @mention notifies a mentioned member who can see the task; a member who cannot see it gets nothing and the response is still 201", async () => {})
test("comment body Drive URLs are withheld off the company PC", async () => {})
test("attachment upload via the task intent works for a tenant without M4 and without files:write", async () => {})
test("GET /v1/files/{id} and /download for a task_% file → 404 file_not_found even with files:read", async () => {})
test("task file download needs task access: out of scope → 404 task_not_found; another task's fileId → 404 file_not_found", async () => {})
test("evidence purpose accepts video/mp4 up to TASK_VIDEO_MAX_BYTES; attachment purpose refuses video (422 mime_not_allowed)", async () => {})
test("search: staff finds own task by ref and title, not a colleague's; team manager finds direct reports' tasks; owner finds all", async () => {})
test("search body never contains a Drive URL or an email", async () => {})
test("nested ids: A's task with B's commentId or itemId → 404 comment_not_found / checklist_item_not_found", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL. Implement (the `UploadPolicy` default is the old behaviour, so the B2 file tests stay unchanged). Add `ROUTE_PARAMS`/`SPECS` for every new path (`checklistItem`, `comment` and `taskFile` resources). PASS. Commit `feat(api): task checklists, subtasks, comments, task uploads and scoped search`.

### Task T4.3: Projects, milestones, dependencies, knock-on, date proposals

**Files:**
- Domain `task-planning.ts` (port).
- `db/schema/projects.ts` + migration `0029_projects_deps.sql`:
  - `projects(id, tenant_id, name 1..120, team_id null, lead_id text null, description ≤ 4000, due_date date null, default_evidence_rule jsonb null, created_at, updated_at, version int)`.
  - `project_milestones(id, tenant_id, project_id, name 1..120, due_date date, position)` with FK `(tenant_id, project_id)` on delete cascade.
  - `task_dependencies(tenant_id, task_id, depends_on_id, pk(task_id, depends_on_id))` with both composite FKs cascade, `check(task_id <> depends_on_id)`.
  - Composite FKs from `tasks.project_id` / `milestone_id`.
  - Indexes `task_deps_on_idx (tenant_id, depends_on_id)`, `tasks_project_idx (tenant_id, project_id) where archived_at is null`.
- `modules/projects/*`; `modules/tasks/planning.ts`.

**Interfaces:**

| Method + path | Permission | Notes |
|---|---|---|
| `GET /v1/projects` | `tasks:read` | projects + milestones + progress `{done,total,pct}` over live tasks (aggregate) + `milestoneState` in tenant-local today |
| `POST /v1/projects` | `tasks:write` + manager-home | 201 |
| `GET /v1/projects/{id}` · `PATCH /v1/projects/{id}` · `DELETE /v1/projects/{id}` | read / manager write | PATCH `{ version, … , defaultEvidenceRule? }`; DELETE unlinks tasks (`project_id`/`milestone_id` null, history line on each) and is audited |
| `POST /v1/projects/{id}/milestones` · `PATCH`/`DELETE /v1/projects/{id}/milestones/{milestoneId}` | manager write | milestone date edits notify assignees of linked tasks (FR-M1-11/12) |
| `PATCH /v1/tasks/{id}` | manage | + `projectId`, `milestoneId` (the milestone must belong to the project, else 422 `invalid_milestone`) |
| `PUT /v1/tasks/{id}/dependencies` | manage | `{ version, dependsOnIds ≤ 20 }`; `TASK_GRAPH_LOCK_NS` first, then `wouldCycle` on the tenant's live edges; 422 `dependency_cycle` / `invalid_dependency` |
| `POST /v1/tasks/{id}/reschedule/preview` | manage | `{ start, due }` → `{ moves: (DateMove & { taskId, outOfScope })[], previewHash }` |
| `POST /v1/tasks/{id}/reschedule` | manage | `{ version, start, due, reason?, knockOn: { apply, previewHash? } }`; every moved task gets a history line + notification |
| `POST /v1/tasks/{id}/date-proposal` | assignee | `{ start, due, reason }` (Q8); notifies the managers in scope |
| `POST /v1/tasks/{id}/date-proposal/approve` | manage | `{ version, knockOn }` → same path as reschedule |
| `POST /v1/tasks/{id}/date-proposal/decline` | manage | `{ version, reason? }` |

Knock-on runs `knockOn()` on tenant-local wall strings (it shifts whole days and keeps the wall time), then converts each result with `wallToEpoch`.

- [ ] **Step 1: Failing tests**

```ts
test("concurrent opposite dependency edits cannot form a cycle", async () => {        // Review Focus #2
  const [r1, r2] = await Promise.all([putDeps(A, [B.id]), putDeps(B, [A.id])])
  expect([r1.status, r2.status].sort()).toEqual([200, 422]); expect(await hasCycle(tenant)).toBe(false)
})
test("self-dependency and a 3-node loop → 422 dependency_cycle; a dependency id from tenant B → 422 invalid_dependency", async () => {})
test("preview lists every pushed dependant down the chain; apply with the same hash moves exactly those", async () => {})
test("apply after a dependant changed → 409 knock_on_changed and nothing moves", async () => {})
test("a dependant outside a team manager's scope is flagged outOfScope; apply → 409 knock_on_out_of_scope; apply:false moves only the task", async () => {})
test("knock-on across 25 Oct 2026 keeps 09:00 local (08:00Z before, 09:00Z after)", async () => {})
test("knock-on ignores archived, completed and cancelled dependants", async () => {})
test("member proposes dates; manager approves with knock-on; history and notifications for both", async () => {})
test("milestone date change notifies assignees of the milestone's tasks with old and new dates", async () => {})
test("project progress counts live tasks only; milestone 'late' uses the tenant-local today", async () => {})
test("project delete is audited and unlinks tasks without deleting them", async () => {})
test("staff cannot create projects or edit milestones (403 forbidden)", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL. Implement. Add SPECS for `/v1/projects/{id}`, `/milestones`, `/milestones/{milestoneId}`, `/v1/tasks/{id}/dependencies`, `/reschedule`, `/reschedule/preview` and `/date-proposal*` (resources `project`, `milestone`). PASS. Commit `feat(api): projects, milestones, dependencies and knock-on reschedule`.

### Task T4.4: Recurrence and templates as scheduled jobs

**Files:**
- Domain `task-recurrence.ts`, `task-templates.ts` (port).
- `task_templates(id, tenant_id, name 1..80, title, description, team_id null, assignee_id text null, priority, labels text[], evidence_rule jsonb, due_offset_days int 0..365, due_time text HH:mm, created_by, created_at, version)` in migration `0030_recurrence_templates.sql`, plus `tasks_series_occ_uq unique (tenant_id, series_id, occurrence_date)` and `tasks_series_live_idx (tenant_id) where repeat is not null and archived_at is null`.
- `modules/task-templates/*`; `modules/tasks/recurrence.ts`; `worker.ts` (`registerTasks()` + scheduler `tasks.recurrence` every 15 min).

**Interfaces:**

| Method + path | Permission | Notes |
|---|---|---|
| `PUT /v1/tasks/{id}/repeat` | manage | `{ version, rule: RepeatRule \| null }`; `repeatError` → 422 `invalid_repeat`; `per_shift` → 422 `unsupported_repeat`; an instance cannot itself repeat (422) |
| `GET /v1/task-templates` | `tasks:read` | |
| `POST /v1/task-templates` | manager-home `tasks:write` | `templateFromForm` shape |
| `PATCH /v1/task-templates/{id}` · `DELETE /v1/task-templates/{id}` | manager write | `{ version, … }`; delete is audited |
| `POST /v1/tasks` | | + `templateId?`: the server applies D23 rule inheritance only. Field filling stays client-side (`applyTemplate`). |

Job `tasks.recurrence` (`{}`):
- For each `active` tenant entitled to M1 (`tenants` has no RLS), run per tenant with try/catch and `withTenant`.
- Compute local today = `epochToWall(now, tz).slice(0, 10)`.
- For each live series: `nextOccurrences(rule, max(repeat_cursor ?? due_local, today − 7), today)`.
- Insert instances `ON CONFLICT (tenant_id, series_id, occurrence_date) DO NOTHING`:
  - `due_at = wallToEpoch(date + series due time, tz)`, start = same lead days and start time;
  - copy assignees, labels, evidence rule, voice file id and project; status `not_started`, round 1;
  - history "Created from recurring task <ref>" with actor `system:recurrence`.
- Advance `repeat_cursor = today`, publish `task.created`, notify assignees.
- If skipped dates are older than the 7-day window: one series history line "N occurrences skipped (outside catch-up window)".

- [ ] **Step 1: Failing tests**

```ts
test("recurrence creates exactly one instance per local date across the October DST change, even with two concurrent runs", async () => {   // Review Focus #1
  // tenant Europe/Dublin, daily series due 01:30; clock steps 15 min from 2026-10-24T22:00Z to 2026-10-26T03:00Z, runJob x2 in parallel each tick
  // expect occurrence_date set == {2026-10-25, 2026-10-26}; due_at 25th = 2026-10-25T00:30Z (earlier 01:30), 26th = 2026-10-26T01:30Z
})
test("spring-forward: due 01:30 on 2027-03-28 becomes 02:30 local (01:30Z), one instance", async () => {})
test("weekly Mon/Wed series with until stops after until; monthly day 31 lands on 30 Nov and 28 Feb", async () => {})
test("catch-up is capped at 7 days and logs the skipped count once", async () => {})
test("instances inherit the series evidence rule, assignees and voice file; templates never carry a voice note", async () => {})
test("job skips suspended tenants and tenants without M1; re-enabling resumes from the cursor within the 7-day window", async () => {})
test("archived or purged series stop producing instances", async () => {})
test("task created with templateId inherits the template evidence rule when the body has none; project default applies when neither is set", async () => {})
test("templates CRUD: staff 403 on write; template from another tenant → 404 template_not_found", async () => {})
test("per_shift rule → 422 unsupported_repeat", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL. Implement. Add SPECS for `/v1/tasks/{id}/repeat` and `/v1/task-templates/{id}` (resource `template`). PASS. Commit `feat(api): recurring tasks and templates as scheduled jobs`.

### Task T4.5: Archive, restore, audited purge, board/calendar/archive queries — **strongest reviewer (purge)**

**Files:** `modules/tasks/{archive,views}.ts`; migration `0031_task_archive.sql`: `tasks_archived_idx (tenant_id, archived_at) where archived_at is not null` (the calendar needs no new index: it queries a UTC `due_at` range on `tasks_live_due_idx`). Job `tasks.archive-purge` hourly in `worker.ts`.

**Interfaces:** Static paths are registered before `/{id}`.

| Method + path | Permission | Notes |
|---|---|---|
| `POST /v1/tasks/{id}/archive` | manage | `{ version }`; cascades to open subtasks (one `archive_batch_id`); audit `task.archived`; removes search docs; dependants lose the edge in knock-on (edges are kept) |
| `POST /v1/tasks/{id}/restore` | manage | `{}`; 410 `archive_expired` after 30 days; restores the whole batch; audit `task.restored`; re-index |
| `DELETE /v1/tasks/{id}` | `settings:write` (tenant admin), human | purge; 409 `task_not_archived` if live; deletes rows (FK cascade), unlinks dependants, queues `file.delete-object` for task files not referenced elsewhere, removes search docs; audit `task.purged` `{ before: { ref, archivedAt }, after: null }` |
| `GET /v1/tasks/archive` | `tasks:read` + manage scope | cursor `(archived_at desc, id)`; `daysLeft` from `archiveDaysLeft` in tenant time |
| `GET /v1/tasks/board` | `tasks:read` | same filters as the list; `{ columns: { status, count, items ≤ 50, nextCursor }[] }` in `STATUS_ORDER` |
| `GET /v1/tasks/calendar` | `tasks:read` | `?from=YYYY-MM-DD&to=YYYY-MM-DD` (≤ 42 days, 422 `invalid_range`); `{ days: { date, tasks: TaskCard[] }[] }` grouped by the tenant-local due date |

Job `tasks.archive-purge`: per active tenant, purge tasks with `archived_at ≤ now − 30 days` in batches of 200. Audit actor `system:archive-retention`. Idempotent: an already purged id is a no-op.

- [ ] **Step 1: Failing tests**

```ts
test("archived tasks are excluded from list, board, calendar, search and knock-on, and return on restore", async () => {   // Review Focus #4
  // also: applyTaskUpdate on an archived task returns "skipped_archived" and writes nothing
})
test("archive cascades to open subtasks; restore brings back the same batch only", async () => {})
test("restore after 30 days → 410 archive_expired; at 29d23h → 200 (fake clock)", async () => {})
test("purge needs settings:write and a human: manager 403, api key 403 human_required, admin 204; audit has task.purged with ref only", async () => {})
test("purge of a live task → 409 task_not_archived; purge deletes evidence and voice files via file.delete-object but keeps a voice file shared with a live instance", async () => {})
test("retention job purges at 30 days, audits as system:archive-retention, and a second run does nothing", async () => {})
test("PATCH/status/complete on an archived task → 409 task_archived", async () => {})
test("calendar groups by tenant-local due date across DST: due 2026-10-25T00:30 local (23:30Z on the 24th) is on the 25th; due 2026-10-26T00:30 local (00:30Z) is on the 26th", async () => {})
test("board columns follow STATUS_ORDER with counts that respect the caller's scope", async () => {})
test("calendar range > 42 days → 422 invalid_range", async () => {})
test("board and calendar use tasks_live_status_due_idx / tasks_live_due_idx (EXPLAIN)", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL. Implement. Add SPECS for `/archive`, `/restore` and `DELETE /v1/tasks/{id}`. The DELETE spec actor is `owner` (owner has `settings:write`); the control run uses an archived A task. PASS. Commit `feat(api): task archive, audited purge and board/calendar queries`.

### Task T4.6: Evidence rules, items, reviews, verify/reject — **strongest reviewer (verification)**

**Files:**
- Domain `task-evidence.ts` (`canVerify` adds the co-assignee check, D8; FE test updated).
- `db/schema/task-evidence.ts` + migration `0032_task_evidence.sql`: `task_evidence(id, tenant_id, task_id, round int, kind text check in EVIDENCE_TYPES, file_id uuid null, text text null ≤ 2000, url text null, source text check in ('camera','upload') null, captured_at null, device_id uuid null, review text check in ('pending','accepted','rejected') default 'pending', reason text null, reviewed_by text null, reviewed_at, created_by text, created_at, locked_at)`.
  - `check (kind in (photo,image,pdf,office,video,signature) = (file_id is not null))`, `check (kind = 'note' = (text is not null))`, `check (kind = 'drive' = (url is not null))`.
  - Indexes `task_evidence_task_idx (tenant_id, task_id, round)`, `task_evidence_gallery_idx (tenant_id, review, created_at, id)`.
- `modules/task-evidence/*`; a `file.scanned` subscriber (infected → auto-reject).

**Interfaces:**

| Method + path | Permission | Notes |
|---|---|---|
| `PUT /v1/tasks/{id}/evidence-rule` | creator or manage | `{ version, rule }`; `normaliseRule` + `ruleError` → 422 `invalid_evidence_rule`; named reviewer must be an active member with `tasks:read` (422 `invalid_reviewer`); also accepted on `POST /v1/tasks` |
| `POST /v1/tasks/{id}/evidence` | assignee or manage | `{ kind, fileId?, text?, url?, source?, capturedAt? }`; the file must be a `task_evidence` file of this task (else 404 `file_not_found`); `isTypeAllowed` → 422 `evidence_type_not_allowed`; `drive` needs `driveAllowed` (403 `device_policy`) and `isDriveUrl`; `checklist` stores "Checklist n/m" from the task checklist |
| `DELETE /v1/tasks/{id}/evidence/{evidenceId}` | uploader | only unlocked items; 409 `evidence_locked` |
| `GET /v1/tasks/{id}/evidence/{evidenceId}/download` | `tasks:read` | 302; Drive items → 404 `evidence_not_found` off the company PC |
| `POST /v1/tasks/{id}/complete` | | now uses real items: `completeTarget` → completed (auto: items accepted) / submitted ("Awaiting verification", `submitted_at`) / 422 `evidence_required`; pending scan → 409 `evidence_not_ready`; current-round items locked |
| `POST /v1/tasks/{id}/verify` | reviewer | `{ version, evidenceIds? }` (default: all pending in the current round); when every valid item is accepted → completed; audit `task.evidence_verified` |
| `POST /v1/tasks/{id}/reject` | reviewer | `{ version, reason 1..500, evidenceIds? }` → items rejected, task `changes_requested`, `round + 1`, reason as a comment, assignees notified; audit `task.evidence_rejected` |
| `GET /v1/evidence` | manager-home `tasks:read` | gallery (FR-M1-49): `?teamId&date&state=awaiting\|verified\|rejected`, cursor; scope-filtered |
| `POST /v1/evidence/verify-batch` | reviewer | `{ items: { taskId, version, evidenceIds? }[] ≤ 50 }` → per-item `{ taskId, status, code? }`; each item in its own savepoint |

Reviewer = `canVerify(rule, { id: me, manager: canManage }, task)` with D8 on top: the uploader of any targeted item, or any assignee → 403 `self_verification`; an API key → 403 `human_required`; others → 403 `not_a_reviewer`. A task not `submitted` → 409 `invalid_transition`. DTO: `evidence[]` (FE `Evidence` shape + `fileStatus`), `evidenceState` (`evidenceState()`), list filter `evidence=verified|awaiting|rejected|missing` (FR-M1-48 progress view). Drive items pass through `withholdDriveLinks`.

- [ ] **Step 1: Failing tests**

```ts
test("AC-M1-08: 'Not needed' closes with one call; Required min 2 PDF cannot close with 1 (422 evidence_required); a rejected item reopens the task for the assignee", async () => {})
test("AC-M1-05: proof-required task cannot be completed without proof; manager sees the photo with capturedAt and source and verifies it", async () => {})
test("nobody verifies evidence they uploaded or on a task they are assigned to; keys cannot verify", async () => {   // Review Focus #3
  expect((await verify(managerWhoIsCoAssignee)).code).toBe("self_verification")
  expect((await verify(managerWhoUploaded)).code).toBe("self_verification")
  expect((await verify(apiKeyWithTasksWrite)).code).toBe("human_required")
  expect((await verify(staffNotReviewer)).code).toBe("not_a_reviewer")
})
test("review modes: auto accepts on complete; creator mode lets the creator verify; named mode lets only the named reviewer (who can now see the task) verify", async () => {})
test("pending scan blocks complete with 409 evidence_not_ready; infected file auto-rejects its item with reviewer system:scanner", async () => {})
test("submitted items are locked: delete → 409 evidence_locked; resubmission after reject is round 2 and round-1 items stay as earlier versions", async () => {})
test("AC-M1-06: drive evidence attach on a non-PC device → 403 device_policy; on the trusted company PC → 201; the item reads 'Google Drive link' on Android", async () => {})
test("concurrent verify and reject on the same submission: one wins, the other 409 version_conflict", async () => {})
test("verify-batch verifies the allowed items and reports self_verification for the rest, without rolling back the others", async () => {})
test("gallery lists awaiting items of the manager's team for a tenant-local day only", async () => {})
test("evidence ids: A's task with B's evidenceId → 404 evidence_not_found; B's file id in the body → 404 file_not_found", async () => {})
test("named reviewer from another tenant or without tasks:read → 422 invalid_reviewer", async () => {})
test("verify and reject are audited in the same tx with ids only; events task.evidence_verified/rejected carry ids only", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL. Implement. Add SPECS for `/evidence-rule`, `/evidence`, `/evidence/{evidenceId}`, `/evidence/{evidenceId}/download`, `/verify` and `/reject` (resource `evidence`). Extend the DSR handler: export = the subject's evidence metadata; erase = null `created_by`/`reviewed_by` (files are kept until the task purge, D13). PASS. Commit `feat(api): task evidence rules, items and independent review`.

### Task T4.7: Voice instructions on tasks

**Files:** `modules/tasks/voice.ts`; migration `0033_task_voice.sql`: `task_voice_access(id, tenant_id, task_id, file_id, user_id text, at)` + index `(tenant_id, task_id, at)`.

**Interfaces:**

| Method + path | Permission | Notes |
|---|---|---|
| `POST /v1/tasks/{id}/uploads` | creator or manage | `purpose: "voice"` (T4.2 route; D21 limits) |
| `PUT /v1/tasks/{id}/voice-note` | creator or manage | `{ version, fileId, durationSec }` → sets `voice_file_id` + `voice_meta { durationSec, mime, recordedBy, recordedAt }`; the replaced file is deleted unless still referenced; history "Voice instructions added/replaced" |
| `GET /v1/tasks/{id}/voice-note` | `tasks:read` | 302 to a 60 s presigned GET (`Cache-Control: no-store`) after `clean`; 409 `file_not_ready`; inserts `task_voice_access` |
| `DELETE /v1/tasks/{id}/voice-note` | creator or manage | `{ version }`; 404 `voice_note_not_found` if none |

DSR: export = voice notes the subject recorded (metadata). Erase = delete every voice note they recorded: clear `voice_*` on all tasks that share the file and queue its deletion.

- [ ] **Step 1: Failing tests**

```ts
test("voice note: declared durationSec 121 → 422 voice_too_long; size over TASK_VOICE_MAX_BYTES → 422 file_too_large; audio/webm;codecs=opus is accepted as audio/webm", async () => {})
test("anyone who can see the task can play it; out of scope → 404 task_not_found; every play writes task_voice_access", async () => {})
test("staff assignee cannot set or delete the voice note (403 forbidden); the creator and managers can", async () => {})
test("replacing a voice note deletes the old file unless a recurring instance still references it", async () => {})
test("erasure of the speaker removes their voice notes from every task sharing the file and queues file deletion", async () => {})
test("no job other than file.scan and file.delete-object is ever enqueued for a voice file (no AI or transcription)", async () => {})
test("voice playback works without M4 and is 403 module_not_entitled once M1 is removed", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL. Implement. Add SPECS for `/v1/tasks/{id}/voice-note`. PASS. Commit `feat(api): voice instructions on tasks`.

---

## Spec coverage (self-review)

| Requirement | Task |
|---|---|
| FR-M1-01 fields, assignee(s), priority, dates, estimate, labels, status | T4.1 |
| FR-M1-02 subtasks, checklists / recurring / finish-to-start | T4.2 / T4.4 (per shift → B5, D11) / T4.3 |
| FR-M1-03 comments, @mentions, attachments / history | T4.2 / T4.1 |
| FR-M1-04 projects, milestones, deadlines | T4.3 |
| FR-M1-05 list, Kanban, calendar (Must) | T4.1 list, T4.5 board + calendar (timeline/workload Should → D18) |
| FR-M1-10 manager sees team tasks | T4.1 (D5) |
| FR-M1-11 manager edits, reassigns, reschedules incl. milestone dates | T4.1, T4.3 |
| FR-M1-12 notify + old/new history | T4.1 (AC-M1-04), T4.3 |
| FR-M1-13 archive 30 days, admin purge | T4.5 |
| FR-M1-14 knock-on before saving | T4.3 (D20) |
| FR-M1-40/41/42 rule, types/min/instruction, defaults | T4.6, T4.4 (D23) |
| FR-M1-43/44/45 complete gate, review modes, verify/reject | T4.6 (AC-M1-05, AC-M1-08) |
| FR-M1-46 capture metadata, limits, scan | T4.6 (D10, D19; location off, Q6) |
| FR-M1-47 platform storage, read-only, versions | T4.2 uploads, T4.6 |
| FR-M1-48 state in task/list/progress | T4.6 (`evidenceState`, filter); shift report view → B5 |
| FR-M1-49 gallery + bulk verify (Could) | T4.6 |
| AC-M1-06 Drive on PC only | T4.1 / T4.2 / T4.6 (D22) |
| Voice instructions change request | T4.7 (D21) |

## Done criteria for B4

- Every FR in the table above has a passing test. AC-M1-04, AC-M1-05, AC-M1-06 and AC-M1-08 pass as API tests.
- All five Review Focus tests pass. The DST tests for due dates, calendar, knock-on and recurrence pass for 25 Oct 2026 and 28 Mar 2027 in Europe/Dublin.
- Isolation walker green with `ROUTE_PARAMS` + `SPECS` for every new path-param route (task, checklistItem, comment, taskFile, project, milestone, template, evidence); RLS guard green for all new tables.
- API-key principal covered: `tasks:read`/`tasks:write` scopes, creator-based scope via `subjectUserId`, `human_required` on verify/reject/purge.
- Removing M1 blocks every B4 route with 403 within 60 s and keeps the data. Jobs skip suspended tenants and tenants without M1.
- FE Vitest suites for `features/tasks/*` and `packages/domain` stay green after the port (re-export shims only).
- EXPLAIN tests show the named indexes for list, board, calendar, archive, history and gallery queries.
- `features/tasks.md` "Backend" note updated with the route list and rulings D2–D4 for B6.
