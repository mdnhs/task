# Shift Reports (`/daily-reports`): Phase 1 step 2

SRS: FR-M1-22..31, CR-01, CR-03, AC-M1-01..03. Replaces the per-department daily report. The URL stays `/daily-reports`
(old links keep working); the nav label is "Shift Reports" (`public/data/shell/navigation.json`).

| Q | Built as |
| --- | --- |
| Q4 | A report holds one row per shift task (status done / in progress / blocked / not started, minutes, note), summary, blockers, unplanned work rows (text + minutes), mock attachments, plus any extra template sections. |
| Q7 | Due `reportDueAfterMinutes` (tenant data, seed 60) after the shift end. At the due time a missing report alerts the member and their primary manager (in-app feed). |

## Files

| Where | What |
| --- | --- |
| `lib/shift-report.ts` | Pure model: types, tasks-in-shift rule, `buildDraft`, `mergeStored`, `reportRows`, `reportState`, `needsAction`, `currentReport`, template (`templateFor`, `validateReport`), `submitReport` / `acceptReport` / `returnReport`, `taskStatusFor` + `taskUpdatesFor`, scope (`teamOf`, `scopeReports`), filters. Tests: `lib/shift-report.test.ts` |
| `lib/permissions.ts` | `reportScope(role, meId)` → own / team / all |
| `lib/notify.ts` | `missingReportAlerts` (FR-M1-30); the shell bell lists the API's notifications (T6.4), so no client-side alert generation |
| `features/reports/` | B6 T6.7, on the API: `adapters.ts` (`toReport` strict, instants to tenant walls), `time.ts` (state, countdown and "late/missing" from INSTANTS), `client.ts` (open, draft autosave 800 ms with `version`, idempotent submit `{ version, requestId }` with ONE request id per attempt, accept/return, attachments through the scan gate, template), `export.ts` (server export jobs: request, poll 1 s then 2 s, open `/download` with a fresh nonce, never stored), `export-rows.ts` (a re-export of `@opsdesk/domain/report-export`: ONE builder, parity test), `api.ts` (loaders; the inbox is the API's cursor pages and one-level scope), components: `reports-view` (prompt, My shift report, inbox), `report-inbox`, `report-page` → `report-editor` / `report-review`, `report-parts`, `version-history`, `export-menu`, `skeletons` |
| `public/data/reports/reports.json` | Stored reports keyed by `shiftKey` (`p-marcus:pat-sec-night:2026-10-19`). Items may be partial: they are laid over the tasks found in the shift |
| `public/data/settings/template.json` | The report template per team (Settings → Report template edits the same shape) |
| `app/(app)/daily-reports/` | `page.tsx`, `loading.tsx`, `[id]/page.tsx`, `[id]/loading.tsx` |

## Rules

- Rows: every shift that started by tenant now in the last 7 days, for people whose effective reporting is on for that shift's team
  (`reportsFor(…, pattern.team)`, AC-M1-01). A stored report whose shift no longer reports is still listed.
- Tasks in a shift (FR-M1-23, AC-M1-02): assigned to the person, not cancelled, `start` before the shift end, and not finished
  (completedAt, else submittedAt, else due for a finished task) before the shift start. So due-in-window, active and overdue open
  tasks are in; tasks finished on an earlier shift are out.
- Status: stored `draft | submitted | accepted | returned`; shown `draft | submitted | late | missing | accepted | returned`.
  Late = first submission after the due time (resubmitting never changes it). Missing = no submission and the due time passed.
  A missing report can still be submitted; it then shows as late.
- Submit validates against the team template (time on done/in-progress rows, note on blocked rows, required summary and extra
  fields…), locks the report (FR-M1-27) and queues one task update per row (FR-M1-26). Rows never move a task backwards; Done goes
  to "Submitted for Review" when the task's evidence is Required and not auto-accepted, else "Completed". Time is logged as a task
  time entry (shown as "Time logged" on the task) with a timeline line.
- Tenant "now" is `org.today` (the mock clock). Submit, accept and return stamp that time.

## Access

| Role | Scope | Can |
| --- | --- | --- |
| Staff-home (`reports` write: supervisor) | own (mock me = `p-daniel`) | Edit and submit own draft / returned reports |
| Staff-home (`reports` read: employee) | own | Read own reports |
| `manager` (roles.json `person: p-grace`, `reportScope: team`) | everyone below Grace in the reporting lines | Accept / return |
| owner, ops (write), admin, auditor (read) | all | Write roles accept / return |
| hr, payroll, platform | none | Access restricted |

The payload is cut on the server (`getReportSeed`): reports, people and templates of the scope only (smoke-tested: supervisor and
manager pages contain no other person's ids). Search uses the same scope.

## Export (FR-M1-31)

Inbox: Export → PDF / Excel / CSV of the filtered date range (From/To filters; empty = the dates of the rows shown): a summary
table per report plus every task row. Report page: the same three for one report. CSV is RFC 4180 with a BOM and formula-safe cells.

## Seed (now = Tue 20 Oct 09:00)

Reporting members: Daniel (day patrol), Marcus (night patrol), Owen (weekend patrol, Security team only), Amara and Nadia (overrides on).
Leo (override off), Grace and Tomasz (Cleaning default off) get none. Mix: accepted, late (Marcus 16 Oct, Amara 16 Oct; Daniel 15 Oct
accepted late), returned (Daniel 16 Oct, Amara 15 Oct), submitted, missing (Daniel 19 Oct draft, Owen 18 Oct, Nadia 15 and 19 Oct),
and Daniel's running shift on 20 Oct as a draft.

## Backend notes (B5)

Rulings and follow-ups: `../superpowers/plans/2026-11-17-backend-b5-followups.md`.

- A report row note lives only in the report. Submitting writes a neutral task history line (`... from the shift report <name>, <date>`) and a neutral time entry note; the note never reaches `task_history` or `task_time_entries` (H4), so a co-assignee or a support grant cannot read it and DSR erase covers it.
- Export (FR-M1-31) is a job in three phases (H5): claim and requester check, a lock-free build in short per-page read transactions, then the storage write and a short final transaction that re-checks the requester's scope. A downgrade during the build fails the export with `forbidden` and writes no file. Files expire after 7 days; erase leaves copies in other managers' exports for up to 7 days.
- The PDF is Latin-1 only: Bengali and other characters print as `?` until a Unicode font is embedded.
- The report scope is one level (me plus direct reports, F5), narrower than the FE `teamOf`; the template matches by team name; the DTO status can be `expired`; `ReportSchema` uses a `catchall` (B6 items).
- Template concurrency (B7 S6): `GET /v1/shift-reports/template` returns a strong `ETag` (hash of the STORED `report_template` setting, the same for every caller; a team rename that rewrites the stored template changes it). `PUT` needs `If-Match`: missing is 428 `precondition_required`, stale (or weak, or `*`) is 412 `precondition_failed` with the current `ETag`, decided under the settings lock so of two PUTs with one tag exactly one wins. The editor (`features/settings/template-session.ts`) sends the tag, shows "Changed by someone else" with Reload on a 412, ignores edits until Reload and never keeps a stale local copy.
- The dashboard "awaiting review" count leaves out the caller's own submitted reports (they cannot review them: `self_review`).
- **Inbox counts and minutes (B8 Task 15, `api/src/modules/shift-reports/inbox.ts`):** `GET /v1/shift-reports` returns `counts: {all, open, missing, late, returned, accepted}` beside the page: the number of items of each STATE in the window under the same scope, `team` and `person` filters as the list but NOT the status filter or the cursor, so a tab count equals the list it opens (the parts add up to `all`). `open` = a draft not yet due + a report submitted on time and not reviewed yet. One aggregate statement over the stored rows (`count(*) filter (where ...)` with the `stateWhere` rules) plus the shifts nobody reported on yet (virtual rows, counted through the same scope-cut walk as the list: `missing` past the due time, `open` before it); a manager's counts include only their own and direct reports' items, a person or team out of scope counts zero (same shape, 200). Each item gains `minutesLate` (real minutes the first submission came after the due time, or `now` minus due while nothing is submitted; 0 when on time) and `minutesOpen` (real minutes from the end of the shift to the first submission, or to now): computed from INSTANTS, so 25 Oct 2026 across the clock change is 90 where wall-clock arithmetic says 30.
- **Inbox web (B8 Task 24):** the status chips show the API's counts (All, Late, Missing, Accepted, Returned; "Submitted" has no number because the API's `open` also holds drafts not yet due, so the header adds "N open"); the header total is the API's count for the active status (no "+" guess); a page after a cursor keeps the first page's counts; under the topbar department (a client cut of loaded rows) no numbers are shown. The Submitted cell says "· 1 h 35 min late" from `minutesLate` (late submissions and missing reports up to now).
- **Inbox counts: first page only (AG2).** `counts` is computed only when the request has no `cursor` (the first page); a page after a cursor answers `counts: null` and the client keeps the counts of the first page. The virtual-row part of the counts walks the whole window (at most 31 days) in ONE pass (one occurrence read and one stored-keys read) instead of one chunk query pair per 3 days; the list itself still walks only the chunks a page needs.
- DSR erase against a reviewer's `notify` can deadlock in theory; the loser gets 409 `retry`.
- `completed_at` can be off by up to an hour inside the repeated DST hour.

## Backend notes (B6 T6.1: strict ReportSchema)
`ReportSchema` (api `modules/shift-reports/dto.ts`) is a strict object with exactly the `ReportDto` fields: no `catchall`, no `z.any()`. `items` (with the optional `outcome`), `attachments`, `comments`, `unplanned` and `extra` are typed, and the version `snapshot` is typed too. An unknown or missing key fails `api/src/modules/shift-reports/dto.test.ts`, so a renamed field can no longer show up as `undefined` in the UI. The OpenAPI walker `api/test/openapi-typed.test.ts` fails on any new untyped 2xx JSON response.

## Backend notes (B6 T6.9: CR-01 and CR-03 on the real stack)
- `e2e/world.ts` builds the shared fixture once in globalSetup: a pattern "E2E all day" (00:00-23:59, every day) given to five members, so a report exists at any hour (a report needs its shift to have started), with reporting off for all five.
- `e2e/cr01.spec.ts`: an all-scope manager turns reporting on for 3 of 5 on `/shifts` -> People; only those three have a report in the inbox; a member sees exactly the tasks due inside their shift (not another member's, not tomorrow's), sets status and minutes, submits; the manager sees the task updated (status, minutes, the neutral line "Status set to ..., N min logged from the shift report ...").
- `e2e/cr03.spec.ts`: the submitted report is in the inbox within a minute (the inbox is re-read on each visit, polled up to 60 s), complete (summary, handover, task row); accept; a seeded past-deadline member is "Missing"; a returned report carries the manager's comment back to the member.
- Deviation from the T6.9 brief and the SRS wording ("accepts it with a comment"): Accept takes no comment in the UI (only Return does), so the spec accepts without one and tests the comment on Return.
