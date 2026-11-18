# Tasks (M1: FR-M1-01..14, FR-M1-40..48; CR-04, CR-05)

Phase 1 steps 3 (evidence rules) and 6 (task model and views), built 28 Oct 2026. Front-end mock: seed in `public/data/tasks/`, one in-memory store (`features/tasks/store.ts`, `useTasksStore`) shared by every task route, so edits on one view show on the others.

## Routes (each has its own `loading.tsx` and skeleton)
| Route | What |
| --- | --- |
| `/tasks` | List (filters incl. Project, `?project=`); evidence state under the status pill |
| `/tasks/board` | Kanban by status. Drag a card (HTML drag and drop) or use "Move to…" (keyboard, touch). Drops follow `boardMove()` |
| `/tasks/calendar` | Month / week by due date, Monday first; phones show a count dot per day |
| `/tasks/projects` | Projects with milestones (`projects.json`), progress from their tasks |
- Remove = `archiveTask()`; `archivedTasks()` hides tasks older than 30 days (a backend purges them). "Delete now" is audited by the API (T6.4 removed the client audit outbox).
| `/tasks/[ref]` | Detail: evidence, checklist, subtasks, dependencies, history, manager tools |
| `/tasks/new` | New task form as a page (was a dialog; it scrolled at 1568×698). Write access only, else "Access restricted". `?from=` = back/Cancel target (internal path only, default `/tasks`), `?assignee=` presets the assignee, `?then=task` opens the new task after Save instead of returning (dashboard "New Task" / "Assign Task"). Links built with `newTaskHref()` (`features/tasks/new-task.ts`); old `/tasks?new=1` redirects here. `loading.tsx` renders the real form masked (`SkMask`) |

## Evidence rules (CR-05) — `lib/task-evidence.ts`
- `Task.evidenceRule = { mode: none|optional|required, types, min, instruction, review: auto|creator|manager|named, reviewer? }`. Replaces the old `evidenceRequired` flag (seed migrated; `legacyRule()` maps old data). Templates carry a rule; recurring instances copy it.
- Types: photo, image file, PDF, Office doc, short video, checklist, signature, note, Drive link ("PC only"; blocked off the work PC by the device policy `driveAllowed`).
- `completeTarget()`: Not needed → Completed with one tap; Required below the minimum → blocked (Complete opens the upload step, `EvidenceStepDialog`); items waiting for a reviewer → `submitted` ("Awaiting verification"); auto-accept → Completed.
- Reviewer verifies (all or per item) or rejects with a reason: the task reopens (`changes_requested`), the reason becomes a note, rejected items stay as "Earlier versions", the next submission is round + 1. Submitted evidence is locked (read-only); drafts can be removed.
- Who verifies: `canVerify()` — managers always; else the creator (creator mode) or the named reviewer; never the assignee.

## Task model and planning (CR-04) — `features/tasks/planning.ts`, `mutations.ts`
- New fields: `assignees` (co-assignees; `assignee` stays primary; `lib/task-scope.ts` `isAssignee` / `activeTasks` make every assignee count and leave archived tasks out in tasks, search, shift reports and the Today card), `estimate` (min), `projectId`, `milestoneId`, `parentRef` (subtask), `checklist`, `dependsOn` (finish-to-start), `archivedAt/By`, `proposal`, `round`.
- `knockOn()`: moving a task pushes open dependants that would start before it is due, by whole days, down the chain (never pulls earlier). Shown in the Reschedule dialog before saving.
- Remove = `archiveTask()`; `archivedTasks()` hides tasks older than 30 days (a backend purges them). "Delete now" is audited by the API (`task.purged`, same transaction as the purge; FR-M0-13). There is no client audit outbox.
- History: `TimelineEvent.changes` holds old → new values; `notified` lists members told about a manager's change. The notices themselves are written by the API and listed by the shell bell (`lib/notifications.ts`); there is no client notice store.
- Changes from outside /tasks (shift report rows, the Today card) are the API's own: submit and `POST /v1/today/updates` update the task and write the history line server-side (B6 T6.7).. Each update id is kept on its timeline line, so it applies once.
- Filters: `status=open` (not done), `status=review` (submitted, not the reviewer's own; managers only). Drive URLs are removed from the seed on devices without Drive access (`withholdDriveLinks`, FR-M1-52).
- Q8 assumption: members don't change dates; they "Propose new dates", a manager reviews (with knock-on) and approves or declines.

## Voice instructions (change request, product owner 30 Oct 2026) — `lib/task-voice.ts`, `components/voice-note.tsx`
- Not in the BA's SRS (row in Appendix A.2). No transcription or AI: speech-to-text and dictation stay in Module 2 (FR-M2-07).
- Model: `Task.voiceNote?: { url, durationSec, mime, recordedBy, recordedAt }`. New task → right column "Voice instructions (optional)": mic → recording with a live timer and Stop → preview with "Record again" / "Remove". Stops by itself at 2:00 and says "Maximum 2 minutes". No MediaRecorder or mic blocked → a short hint, the rest of the form still works. Mic tracks stop on Stop and on unmount.
- Creating a task with a recording adds the timeline line "Voice instructions added". Templates never copy it (it is not part of the form values). Recurring instances copy the series task's fields, so they carry it too.
- Task page: a "Voice instructions" block under the description with the player (play/pause, scrub, elapsed / total), for everyone who can see the task. Loading: a ref the seed lacks (created in this tab) renders masked from the client store (`TaskDetailLoading`), so the skeleton includes the block.
- "Play my day": the Today card reads this session's voiced tasks from the `taskVoice` hand-off (the dashboard can't import tasks; the Today data comes from the server seed, which has no recordings). The task is read, then "Voice instructions:", then the recording at the player's speed. Pause, next, previous, repeat, a speed change and Close stop it.
- Mock: `url` is a `blob:` object URL in this tab's `tasksStore` only; it is gone on reload like every mock edit.
- Privacy: a voice recording is personal data (the speaker's voice). The backend must store it in tenant storage with the task's access rules (no public URLs; short-lived signed URLs), log access with the task, and delete it on a retention rule: with the task when the archived task is purged (30 days), and on erasure requests for the speaker. Never send it to an AI or transcription provider from this feature.
- Backend (B4 T4.7, ruling D21): `PUT|GET|DELETE /v1/tasks/{id}/voice-note` (set/replace and clear need the task creator or a manager, body `{ version, fileId, durationSec }`, 1-120 s, version bumps; play = 302 to a 60 s signed URL, scan gate 409 `file_not_ready` / 410 `file_infected`, every play logged in `task_voice_access`) and `GET /v1/tasks/{id}/voice-note/plays` (managers of the task only). The file comes from `POST /v1/tasks/{id}/uploads` with `purpose: "voice"`; the task DTO carries `voiceNote { durationSec, mime, recordedBy, recordedAt }` only (no file id, no log). The generic task file download refuses voice files. API keys play as `apikey:<id>`. No device-policy restriction (not a Drive link).
- Voice backend notes (T4.7 review): (1) An API key plays as its creator's scope (D5) and the play is logged as `apikey:<id>`; this is deliberate (the key is not on the API-key deny-list). (2) Key plays are not in the creator's DSR export and are not nulled on erasure: the key id is not a person. (3) The play log is not a retention-grade audit trail: it cascades with the task on purge (D13). (4) The creator who can set the note cannot read the plays: that is manager-only (D21). (5) Voice set/replace/clear holds the per-tenant purge advisory lock for the whole mutation, including notify and DTO assembly. (6) Ruling E11: a support grant is refused on `GET /v1/tasks/{id}/voice-note` (`support_forbidden_route`, audited like other denied routes); the plays list is 403 for support (read-only role, not a manager).

## Backend notes (B4 fix wave, rulings E12-E14)
- Notification bodies, history `text` and milestone notices are device-agnostic, so a Drive link in a task title, milestone name or free text is replaced by "Google Drive link" when the line is WRITTEN (E13). The task and milestone rows stay raw; their DTOs are withheld per request (D22).
- A task whose parent is outside the caller's scope has no `parentRef` and `parentId: null` in its DTO. Subtask history lines ("Created as a subtask", "Subtask added") name no ref or title: the viewer of one task may not see the other.
- Setting a repeat rule starts its cursor at tenant-local yesterday: only today and later are produced, never stale back-instances of an overdue task (also after removing and re-adding a rule).
- An assignee needs `tasks:read` (422 `invalid_assignee`); a named reviewer needs `tasks:write` (E9).
- Archive and restore take the task-graph advisory lock first (like `PUT /dependencies`), then the ordered row locks. Postgres 40P01 and 40001 answer 409 `retry`: repeat the same request.
- An attachment file is not downloadable (404 `file_not_found`) once every comment that carried it is deleted (E12). Task files never produce outgoing webhook events (D14).
- DST fold: a wall time in the repeated hour (25 Oct 2026, 01:30) maps to the first instant when it round-trips. The DTO carries ISO `dueAt` and `startAt`; B6 must send the ISO instant for unchanged dates.
- DSR erase leaves pseudonymous ids: `evidence_rule.reviewer`, `proposal.by`, assignee ids in `task_history.changes`, `voice_meta.recordedBy`.
- For B6: the DTO `seriesId` is a uuid (the FE uses a ref); `POST /v1/tasks` takes no `repeat` (two calls, not atomic); every `canVerify` call site must pass the FULL assignee list (D8) so co-assignee managers do not see a Verify button; handle the omitted `parentRef`. More in `superpowers/plans/2026-11-17-backend-b4-followups.md`.

## Not done yet
Timeline (Gantt) and workload views (Should), custom statuses (FR-M1-06), milestone date editing, evidence in the shift report / progress view and gallery bulk verify (FR-M1-48/49), capture device + malware scan (FR-M1-46), "per shift" recurrence.

## Backend notes (B6 T6.1: typed DTO)
`TaskDto` (api `modules/tasks/dto.ts`) now types every nested value the web reads, so `lib/api/schema.d.ts` has no `unknown` left: `checklist` `{ id, text, done }`, `subtasks` `{ id, ref, title, status }`, `notes` (timeline-event shape), `evidence` (`EvidenceItemDto`), `timeEntries` `{ id, at, by, minutes, note, source }`, `proposal` `{ start, due, reason, by, at }`, `repeat` (the `RepeatRule` shape), `voiceNote` `{ durationSec, mime, recordedBy, recordedAt }` (metadata only). The API still returns `notes` and `timeEntries` empty. `api/src/modules/tasks/dto.test.ts` parses a fully filled task and rejects each malformed nested value.

## Web on the API (B6 T6.6)
- Data: `features/tasks/api.ts` (server loaders over `apiServer`), `adapters.ts` (`toTask`, `toCard`, `toPatch`, `toTaskBody`, `toEvidence`, `toTimeline`, `toProject`, `toTemplate`; a missing required field throws), `client.ts` (every write; the uuid in the path, the current `version` in the body; uploads: intent, PUT, complete, wait for clean).
- Writes: `use-task-writes.ts` = optimistic overlay (`overlay.ts`, pure) + `useApiAction` (one request per key, `409 retry` repeated once, mapped copy plus Ref, refresh after every answer). The server record wins; success is announced only after the API said yes.
- Scope is the server's: no `isAssigned`, no `ME_ID`. A task the caller may not see is a 404, shown as "Task not found". Lists, board columns and the archive page by cursor; the calendar asks for the tenant's 42-day window.
- Dates: wall strings are for display, comparisons read `dueAt`/`startAt` (`time.ts`). `PATCH` leaves an unchanged date out (the API's `Wall` refuses a "Z" instant), so the repeated DST hour cannot shift it. Reschedule/approve show the SERVER's preview, send its `previewHash`, and repeat the preview on `409 knock_on_changed`; hidden moves are a count.
- Evidence (D8, D10): `evidence-view.ts` holds `canVerifyTask(task, viewer)` (whole assignee list, uploader by name), the counted evidence (only clean files) and the Scanning/Infected pills. Drive links are whatever the API sent.
- Voice (D21): `components/voice-card.tsx`; the player asks for a fresh play path per click (`playUrl`), the API answers with a 60 s redirect and logs the play; no URL is kept.
- Recurring instances come from the API job; `materialiseRecurring`, `store.ts` and `task-detail-loading.tsx` are gone.
- Skeletons are static (K1): see `app/(app)/tasks/**/loading.tsx`.

## Backend notes (B6 T6.9: CR-04 and CR-05 on the real stack, and what the walk found)
- `e2e/cr04.spec.ts`: a manager adds a task for a member in the New task form, reschedules it (the dialog previews the dependent task that moves too), reassigns it, removes it; the member's bell shows New task, Task rescheduled and Task assignment changed, the new assignee's bell shows Task removed, and the timeline lists each change.
- `e2e/cr05.spec.ts`: a proof-required task cannot be completed (the evidence step opens with "1 more needed"; the API says `422 evidence_required`); a photo goes to MinIO and ClamAV (the row reads Scanning, then counts); Complete moves the task to review; the assignee and a co-assignee manager get no Verify; a different manager verifies and sees the capture time and "Taken with the camera".
- Defects the walk found and fixed: archiving a task did not notify anyone (AC-M1-04: now assignees and creator get "Task removed" and the history line lists them); the timeline printed raw user ids in "Notified ..." (now names; "Member" for people the caller cannot see); a co-assignee outside the caller's scope showed as a raw id with a "?" avatar (now "Member").
- Not changed: a removed task leaves every list and `GET /v1/tasks?ref=` (managers read it in Tasks -> Archive), so its history is no longer reachable from the task page.
