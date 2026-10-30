# Tasks (M1: FR-M1-01..14, FR-M1-40..48; CR-04, CR-05)

Phase 1 steps 3 (evidence rules) and 6 (task model and views), built 28 Oct 2026. Front-end mock: seed in `public/data/tasks/`, one in-memory store (`features/tasks/store.ts`, `useTasksStore`) shared by every task route, so edits on one view show on the others.

## Routes (each has its own `loading.tsx` and skeleton)
| Route | What |
| --- | --- |
| `/tasks` | List (filters incl. Project, `?project=`); evidence state under the status pill |
| `/tasks/board` | Kanban by status. Drag a card (HTML drag and drop) or use "Move to…" (keyboard, touch). Drops follow `boardMove()` |
| `/tasks/calendar` | Month / week by due date, Monday first; phones show a count dot per day |
| `/tasks/projects` | Projects with milestones (`projects.json`), progress from their tasks |
| `/tasks/archive` | Removed tasks, restorable 30 days (managers); "Delete now" for tenant admins (settings write) |
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
- Remove = `archiveTask()`; `archivedTasks()` hides tasks older than 30 days (a backend purges them). "Delete now" writes a `purge` audit event through `lib/audit-outbox.ts` (FR-M0-13).
- History: `TimelineEvent.changes` holds old → new values; `notified` lists members told about a manager's change. Notices go to `lib/task-notices.ts` (outbox); `hooks/use-notify-feed.ts` subscribes and adds the member's notices to the shell bell once each.
- Changes from outside /tasks arrive through `lib/task-inbox.ts` and `applyTaskUpdates`: shift report rows (status + time) and the Today card ("Mark done", "Snooze" = timeline line only). Each update id is kept on its timeline line, so it applies once.
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

## Not done yet
Timeline (Gantt) and workload views (Should), custom statuses (FR-M1-06), milestone date editing, evidence in the shift report / progress view and gallery bulk verify (FR-M1-48/49), capture device + malware scan (FR-M1-46), "per shift" recurrence.
