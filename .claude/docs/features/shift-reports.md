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
| `lib/shift-reports-data.ts` | Server loader `getShiftReportData(org)`: stored reports + fresh drafts for the last `REPORT_HISTORY_DAYS` (7) days |
| `lib/permissions.ts` | `reportScope(role, meId)` → own / team / all |
| `lib/notify.ts` | `missingReportAlerts` (FR-M1-30); `lib/notify-data.ts` filters them per viewer into `NotifyContext.alerts`; `hooks/use-notify-feed.ts` adds them once |
| `lib/task-inbox.ts` | `TaskUpdate` queue (`pushUpdates`, `updates`); `features/tasks/store.ts` `applyTaskUpdates` applies them in `useTasksStore` |
| `features/reports/` | `api.ts` (`getReportSeed`, scoped seed), `store.ts`, `export-rows.ts` (+ `toCsv`), `export.ts` (+ `exportCsv`), components: `reports-view` (prompt, My shift report, inbox), `report-inbox`, `report-page` → `report-editor` / `report-review`, `report-parts`, `version-history`, `export-menu`, `skeletons` |
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
