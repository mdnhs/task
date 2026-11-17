# Backend B5: M1 Shifts, reports, home — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the M1 shift and report features from the real API: shift patterns, assignments and reporting on/off per member with a team default; per-member end-of-shift reports (rows from the member's shift tasks, submit updates the tasks, versions, accept/return with a comment); the "prompt at shift end" and "missing at deadline" alerts as an exactly-once job; PDF / Excel / CSV exports as jobs that write to Files; and the home read models (dashboard, manager attention, Today, staff dashboard) as cached aggregate queries. Every rule the front end already runs (`features/shifts`, `features/reports`, `@opsdesk/domain/{shifts,shift-report,report-deadline,today}`) is ported, not rewritten.

**Architecture:** Three modules: `api/src/modules/shifts/` (patterns, assignments, reporting settings, the DST-safe occurrence engine), `api/src/modules/shift-reports/` (reports, review, uploads, template, alert job, exports) and `api/src/modules/read-models/` (dashboard, attention, Today, cache). All sit behind `requireTenant → requireModule("M1") → requirePermission(...)`. Tables follow the R8 RLS template and the composite `(tenant_id, …)` FK pattern. **Instants are stored as UTC `timestamptz`; wall-clock strings are display only** (Ruling F3). Submit calls the existing `applyTaskUpdate` (B4, non-strict `settleCompletion`), so the evidence rules of T4.6 apply unchanged. Jobs use `deps.clock`, one tx per tenant, and a unique-key ledger for exactly-once alerts.

**Tech Stack:** existing stack (Hono + zod-openapi, Drizzle, Postgres 16 forced RLS, BullMQ via `registerJob` / `upsertJobScheduler`, R2 storage, Vitest + Testcontainers). **New api dependencies: `exceljs`, `jspdf`, `jspdf-autotable`**, pinned to the exact versions already in the root `package.json` (`^4.4.0`, `^4.2.1`, `^5.0.9`) and the lockfile, so no new package enters the tree and the PDF/XLSX layout stays the same as the browser export (Ruling F20).

**Spec:** `.claude/docs/requirements/SRS.md` §5.2 (FR-M1-20..31, 61, 79 partly), §5.4 (AC-M1-01, 02, 03, 06), Appendix A (Q4, Q5, Q7, Q9), CR-01, CR-03; `.claude/docs/features/shifts.md`, `shift-reports.md`; `SRS-v1.2-built.md` (FR-REP-01..13, FR-SHIFT-*) for ids in FE comments; roadmap B5 and Review Focus #2 and #5; follow-ups `2026-11-17-backend-b4-followups.md` (D1–D24, E1–E15), `…b3-followups.md` (C4, C7, C13, C14), `…b2-followups.md` (B1–B16), `2026-11-16-backend-b0-b1-followups.md` (R5, R8, R9, R25, R26). **Depends on B1–B4** (RBAC, teams and reporting lines, audit, events, notifications, files, search, entitlements, API keys, tasks, `applyTaskUpdate`, evidence).

## Rulings (made for B5; binding for B6)

| ID | Ruling | Why | Cost if wrong |
|---|---|---|---|
| F1 | Six tasks. Roadmap T5.1 → T5.1 (plus `per_shift` recurrence, D11). T5.2 splits into T5.2 (member side) and T5.3 (inbox, review, template). Roadmap T5.3 → T5.4, T5.4 → T5.5, T5.5 → T5.6. | One review per concern. | none |
| F2 | **A shift belongs to the calendar date it STARTS on, in the pattern's own zone** (`shift_date`; the tenant zone unless the pattern names one). A 22:00–06:00 shift that starts Sat 24 Oct reports on **24 Oct**, even though it ends on the 25th. The domain `shiftWindow().date` is changed to that pattern-local date (it was the tenant-local date, which differs only for a pattern whose zone differs from the tenant's and made `shiftsOn` and the report key disagree). Same-zone patterns behave exactly as before. | FR-M1-20 "days the shift starts on", the FE rule, and one stable key `(user, pattern, shift_date)`. | a report for an overnight shift appears under the start day, not the day the member files it |
| F3 | `start_at`, `end_at`, `due_at` are UTC instants computed by the domain engine from the pattern's wall times (`wallToEpoch`: a gap time moves forward, an ambiguous time takes the EARLIER instant, D3) and **stored in the report row when it is first saved**. They are never re-derived from a wall string (a wall time in the repeated hour does not identify an instant). `due_at = end_at + dueAfterMinutes` as epoch minutes (real minutes), not wall arithmetic. A pattern edit changes only occurrences not yet saved; saved reports keep their snapshot. | Review Focus #2; a 22:00–06:00 night is 9 h on 24 Oct 2026 and 7 h on 27 Mar 2027. | a pattern edit does not touch reports already started (a manager must return and the member resubmit) |
| F4 | **A draft is virtual until first saved.** `GET /v1/shift-reports/current` and the inbox compute shifts from assignments and patterns; `POST /v1/shift-reports/open {patternId, date}` get-or-creates the member's own report row (idempotent on `unique (tenant_id, user_id, pattern_id, shift_date)`). Every `{id}` path param is a real row (D2). A shift nobody touched costs no row, and the deadline job works from assignments plus a ledger, not from report rows. | 250 users × several shifts a day would otherwise pre-create thousands of empty rows. | the inbox merges virtual rows in memory (range ≤ 31 days) |
| F5 | Report scope uses D5 semantics through `reportScope(role, me)` and `effectiveReportScope`: staff-home → **own**; manager-home with `reportScope: "team"` → **me + my direct reports** (one level, same as tasks); other manager-home → **all**. "Me" = `subjectUserId(c)`. This is narrower than the FE `teamOf` (direct AND indirect); B6 aligns the seed. Out of scope → **404 `report_not_found`**, no oracle. | The user asked for D5; one scope rule for tasks, reports and search. | a team manager does not see indirect reports' reports |
| F6 | **Accept / return**: manager-home role + `reports:write` + report in its scope, status `submitted` only (409 `report_not_submitted`). **Independence: nobody accepts or returns their own report** (403 `self_review`), manager or owner alike. Return needs a comment 1–2000 chars (422 `comment_required`); accept takes an optional one. API keys cannot submit, accept, return or export (403 `human_required`): a submission is the member's own attestation. The member is notified either way. | FR-M1-29, D8 spirit. | a lone owner needs a second manager to review their own report |
| F7 | **Submit is atomic, versioned and idempotent.** Body `{ version, requestId }` (`requestId` = client uuid). One tx: validate against the team template, lock rows, apply one `applyTaskUpdate` per row, write a frozen `shift_report_versions` snapshot, status → `submitted`. A replay with the same `requestId` returns the stored result (200, no new version); a stale `version` is 409 `version_conflict`. A report that is `submitted` or `accepted` rejects edits and re-submit (409 `report_locked`); `returned` may be edited and resubmitted (new version, `v+1`). | NFR-08 retries on 4G; FR-M1-27. | a client without `requestId` gets 400 |
| F8 | **Time on resubmit is a delta.** The update id of a row is `<reportId>.v<n>.<ref>` (new per version, so status changes re-apply), but the minutes logged are `max(0, new − previous version's minutes)` per row. A decrease is not retracted (documented in the history line). | `taskUpdatesFor` ids are per version; logging the full minutes again would double-count on every resubmit. | time reported on a report can exceed the sum of time entries after a downward edit |
| F9 | **Rows**: the member's shift tasks come from `listTasksForPerson(tx, ctx, personId, window)` (E3), the SQL form of `taskInShift`: any assignee, not archived, not cancelled, `start_at < window end`, and not finished before the window start (finish = `completed_at`, else `submitted_at`, else `due_at` for a finished task). The signature gains `ctx: TaskCtx` (the B4 draft took `tenantId`): the query ANDs `taskScopeWhere(ctx.scope, ctx.reports)`, so it can never return a task the caller may not see. A saved row keeps `task_ref` and a title snapshot; a task that leaves the shift later keeps its row. | E3 + D5. | a title edited after saving shows the old title on the report |
| F10 | **Drive links**: every free-text field of a report (summary, blockers, unplanned text, extra answers, row notes, row titles, comments) goes through `withholdDriveText` **on read** when `!driveAllowed(c)` (D22, per request). Notification bodies carry no report text at all (shift name and date only, E13). Exports are stored files and so always apply `withholdDriveText` at generation. Report attachments are uploads, not Drive links; a `drive` attachment is not offered. | AC-M1-06, FR-M0-10. | a link typed in free text shows as "Google Drive link" in an export even for a PC user |
| F11 | **Evidence in reports (FR-M1-48)**: submit uses the T4.6 path unchanged: `applyTaskUpdate` → `settleCompletion(strict: false)`. A pending scan never fails a report (the row result is `needs_evidence`, history "Report marked done; evidence still needed"); an infected file is auto-rejected by `applyCompletion`; a Required task without clean evidence stays open. Each row in the report DTO carries `outcome` (`applied`, `needs_evidence`, `submitted_for_review`, `skipped_archived`) and a read-only `evidenceState` from `stateItems`. | D10, FR-M1-43/47/48. | none |
| F12 | **Missing and prompt alerts** (T5.4): the ledger `shift_report_alerts` has `unique (tenant_id, user_id, pattern_id, shift_date, kind)` with `kind in ('prompt','missing')`. A run inserts the ledger row `ON CONFLICT DO NOTHING RETURNING` and sends the notifications **in the same tx**; no row returned → send nothing. That gives exactly one alert per (member, shift, day) with two workers, retries, a restart, or the repeated hour. Window: shifts whose due time passed within the last **48 h** (older ones are not alerted; the inbox still shows them as missing). Recipients: the member and their primary manager (`reporting_lines`); no manager → the active `owner` role holders (the SRS says "manager"; a member with none must not be silent). Reporting on/off and the due-after setting are read at run time. | Review Focus #5, FR-M1-30, Q7. | an outage of more than 48 h loses the alert for older shifts |
| F13 | **Settings, no tenant values in code**: `reportDueAfterMinutes` is a tenant setting (`tenant_settings` key `report_due_after_minutes`, 0–1440), edited through the existing `PATCH /v1/settings/organisation` (audited there); its default (60, Q7) and the default report template come from the onboarding data file (`onboarding-defaults.json`: `reportDueAfterMinutes`, `reportTemplate`). The legacy `reportDeadline` (HH:MM) stays for the old daily deadline and is not used by shift reports. | CLAUDE.md "never hard-code tenant values". | none |
| F14 | **Pattern delete = archive** (`archived_at`). No new occurrences, no new assignments; existing reports, versions and history keep their pattern. Pattern create, edit and archive are **all-scope manager only** (403 for team scope; a pattern belongs to a team and a team has no manager). Assignments and per-person reporting overrides: all-scope managers for anyone; a team-scope manager only for **direct reports** (422 `assignee_out_of_scope`, E2). Team default reporting: all-scope only. Staff see only their own assignments and patterns (the `ownShiftState` cut, on the server). | FR-M1-20/21, E2, E6. | a team manager cannot define a pattern |
| F15 | **`per_shift` recurrence (D11)**: `repeat: { freq: "per_shift", patternId }` (422 `invalid_repeat` without a pattern). The existing `tasks.recurrence` job creates one instance per occurrence of that pattern assigned to the series' primary assignee: `start = window start`, `due = window end` (instants), `occurrence_date = shift_date`. Same 7-day catch-up, same unique key and cursor as B4. | D11 promised it for B5. | a member on two patterns the same day needs two series |
| F16 | **Exports**: purpose `report_export` (generated, `clean`, no scan, like `dsr_export`); report attachments use purpose `report_attachment`. **Both need the same treatment as `task_%`**: hidden from `/v1/files` (404), not indexed in search, and the `file.*` webhook fan-out drops them. The existing `startsWith("task_")` checks in `files/service.ts`, `search/subscribers.ts` and `webhooks-out/delivery.ts` become one helper `isScopedPurpose(p)` = prefix `task_` or `report_`. File names carry **no personal data** (`shift-reports-<from>-<to>-<scope>.<ext>`, `shift-report-<8 hex of id>.<ext>`). The requester alone downloads (`GET /v1/report-exports/{id}/download`, 404 for anyone else); the route name already matches `EXPORT_OR_DOWNLOAD`, so API keys and support grants are denied. Files expire after **7 days**. | FR-M1-31, FR-M0-13 (audited data export), privacy. | one more purpose prefix to maintain |
| F17 | **Read models are derived, not stored.** Attention in B5 is the FR-M1-79 feed (overdue, blocked, evidence awaiting review, missing and returned reports), computed from tasks and reports. The FE attention decision queue (decide, history, outstanding items with carry-forward) and the roster / stock / client items are **not** B5: they need persistence and other modules (B8, B11). Coverage and expiring documents (qualifications) are B8/B11. | FR-M1-79; the decision queue has no FR in SRS v1.3. | the FE attention "decide" buttons stay mock until B11 |
| F18 | **Cache**: in-process TTL cache, **30 s**, max 2000 entries, key `rm:<tenantId>:<model>:<scopeKey>:<drive0|1>:<localDay>` where `scopeKey` is `own:<userId>`, `team:<managerId>`, or `all`. One function builds every key, and nothing is cached for support sessions. A write by this instance busts the tenant's keys (`bustReadModels(tenantId)` after commit); other instances catch up within the TTL. M1 and permission checks run before the cache, so removing M1 is still 403 within the entitlement cache window. | NFR-08; no Redis dependency in `Deps`. | a dashboard on another instance can be 30 s stale |
| F19 | New notification kind `report` (in-app and push on, email off) for prompt, missing, submitted, accepted, returned and export-ready. New domain events (ids-only, **not** added to the B3 webhook `PROJECTION`, D14): see "Interfaces locked". | Same as D15. | none |
| F20 | **Export libraries**: `exceljs` (streaming `WorkbookWriter` is not needed at these caps; a plain `Workbook` is written to a Buffer), `jspdf` + `jspdf-autotable`, and the CSV builder `csvCell` in `@opsdesk/domain/csv` (cells starting `= + - @ \t \r` get a leading `'`, RFC 4180, BOM). The pure row builder `features/reports/export-rows.ts` moves to `packages/domain/src/report-export.ts` (FE re-exports it). Limits: range ≤ 92 days (422 `range_too_long`), ≤ 5 000 reports and ≤ 50 000 rows (422 `export_too_large`), PDF ≤ 500 reports (422 `pdf_too_large`, use Excel or CSV), output ≤ 25 MiB. Reports are read in pages of 200 so memory stays bounded. At most 3 queued or running exports per requester (409 `export_limit`). | The FE already uses exactly these libraries; no new package. | very large PDFs need Excel/CSV |
| F21 | **Support grants** are denied the report content, upload and Today routes (`SUPPORT_DENIED_ROUTES`, 403 `support_forbidden_route`, audited): free-text staff reports and personal briefings are not support material. Dashboards and the inbox list (no free text) stay readable. | E11 precedent. | support cannot read a report while helping a customer |
| F22 | **DSR**: export = the subject's reports, versions and comments they wrote. Erase: `shift_reports.user_id` is set to null, the free text of those reports and versions is replaced by `"[erased]"`, the subject's attachments are expired (`expireFile`), `shift_assignments`, `shift_reporting_people` rows are deleted. Ledger rows keep ids only and are deleted too. | B2 DSR registry. | managers lose the narrative of an erased member's reports, not their counts |

## Global Constraints

- All B2/B3/B4 global constraints apply: cross-tenant ids → **404** (never 403); problem+json errors; semantic errors **422**; R8 RLS template on every tenant table (USING and WITH CHECK, `FORCE` appended in the migration); RLS-denial assertions read `.cause` (R9); every JSON body has `.openapi({ example })` (R5); `ROUTE_PARAMS` + `SPECS` for every new path-param route; `deps.clock` only, never `new Date()` or DB `now()`; no secrets, file names or report text in logs.
- **New tables** (R8 exact policy + FORCE, composite FKs `(tenant_id, …)`, minimal column-level `app_user` grants, a grant test, an entry in the isolation `HASHED_TABLES`): `shift_patterns`, `shift_assignments`, `shift_reporting_teams`, `shift_reporting_people`, `shift_reports`, `shift_report_items`, `shift_report_versions`, `shift_report_comments`, `shift_report_files`, `shift_report_alerts`, `report_exports`. The meta-test in `isolation.test.ts` only matches `^(tasks?|task_.*|projects?|project_.*)$`; **extend the regex to `^(tasks?|task_.*|projects?|project_.*|shift_.*|report_.*)$` and raise its minimum count**, so a new `shift_*` or `report_*` table that is not hashed fails the build. All eleven names match the new pattern.
- Migrations continue at **0035** (`0035_shifts`, `0036_shift_reports`, `0037_report_alerts_exports`, `0038_read_model_indexes`).
- `requireModule("M1")` on every route; removing M1 → 403 `module_not_entitled` within 60 s, data kept, re-enable restores it. **Jobs skip tenants that are not `active` (C14), lack M1, or have `billingState === "blocked"` (C13)**, per tenant in a try/catch, as `runRecurrence` does. A blocked tenant's writes are 402 (C13 adds no exemption for shifts or reports).
- **Job ids are `sha256` hex or nonce-based, never containing `:`** (`jobId = sha256("<job>|<tenant>|<key>")`). Idempotency never depends on the job id: the ledger and unique keys are the guard.
- **Lock order** inside a mutation tx: namespaced advisory lock (`SHIFT_LOCK_NS` for pattern and assignment edits; the settings lock for the due-after setting) → `lockActor` (R25; API keys via `lockApiKeyActor`) → rows `FOR UPDATE` ordered by id (report row, then its task rows `ORDER BY id`, then evidence rows inside `settleCompletion`) → writes → history → `notify` → `recordAudit` → `publish` last. **40P01 and 40001 map to 409 `retry`** (already in `app.ts`; each concurrency test asserts it).
- Principal: API keys act with scopes ∩ the creator's current role; data scope is `subjectUserId(c)`; history and audit actor is `actorIdOf(c)`. Keys may read and save drafts (`reports:write` ∩ creator) but not submit, review or export (F6).
- Lists use cursor pagination (`limit` 1–100 default 25, base64url `cursor`, 400 `invalid_cursor`, `{ items, nextCursor }`). Every list query has a named index and an EXPLAIN test.
- p95 < 500 ms at 250 users per tenant and 10 000 live tasks; NFR-08: submit < 2 s.
- DST: all shift and deadline tests cross **Sat 24 → Sun 25 Oct 2026** (fall back, 9 h night) and **Sat 27 → Sun 28 Mar 2027** (spring forward, 7 h night) in `Europe/Dublin`, plus a second tenant zone (`Pacific/Auckland`).

## Review Focus (the five most likely real failures)

1. **Wrong deadline or day across DST** — a 22:00–06:00 night that starts Sat 24 Oct 2026 in Europe/Dublin lasts 9 h; a naive "start + 8 h" or a wall-clock re-parse puts the deadline an hour early, or reads a shift ending 01:30 in the repeated hour as the wrong instant. Expected: `end_at` 2026-10-25T06:00Z, `due_at` 07:00Z, report day 24 Oct; March night end 05:00Z, due 06:00Z; a shift ending 01:30 on 25 Oct ends at 00:30Z. Tests: T5.1 `shift windows across both DST changes`, T5.2 `report rows and deadline for the 24 Oct night`.
2. **Duplicate or skipped alert** — two workers, a retried job, a worker restart, or the repeated 01:30 hour fire "missing" twice, or never. Expected: one `prompt` and one `missing` per (member, shift, day), first sent at or after the true due instant. Test: T5.4 `two workers and the repeated hour send each alert exactly once`.
3. **Half-applied or double-counted submit** — the member double-taps Submit, the network retries, a pending scan blocks one row, or the member resubmits after a return. Expected: one version per `requestId`, all rows updated or none, no double time, no failure on a pending scan. Tests: T5.2 `submit is atomic and idempotent`, `resubmit logs only the extra minutes`, `pending scan never fails a report`.
4. **Scope or Drive leak, self-review** — a team manager reads an indirect report's report, staff read a colleague's, a manager accepts their own report, or a Drive link reaches an Android session through report text. Expected: 404 / 403 `self_review` / links withheld. Tests: T5.3 `report scope`, `nobody reviews their own report`, T5.2 `Drive text is withheld per request`.
5. **Export leak or injection** — a `=cmd()` summary opens as a formula in Excel, the file name holds a person's name, an export includes rows the requester lost access to, a huge range exhausts memory, or someone else downloads it. Expected: `'`-prefixed cells, no PII in names, scope re-checked in the job, caps, requester-only download. Tests: T5.5 (one per case).

---

## File structure

```
packages/domain/src/
  shifts.ts              # shiftWindow().date = pattern-local start date (F2); + occurrenceInstants(pattern, date, tenantTz) → { startAt, endAt, minutes } as epoch ms
  report-export.ts       # moved from features/reports/export-rows.ts (buildReportDoc, buildInboxDoc, toCsv); FE re-exports
  task-model.ts          # RepeatRule: freq "per_shift" + patternId
  task-recurrence.ts     # repeatError accepts per_shift
features/reports/export-rows.ts  → re-export shim (FE tests unchanged)
api/src/
  db/schema/shifts.ts            # shift_patterns, shift_assignments, shift_reporting_teams, shift_reporting_people
  db/schema/shift-reports.ts     # shift_reports, shift_report_items, shift_report_versions, shift_report_comments, shift_report_files, shift_report_alerts, report_exports
  db/migrations/0035_shifts.sql … 0038_read_model_indexes.sql
  modules/shifts/{routes,service,repo,occurrences,reporting,dto,events,index}.ts
  modules/shift-reports/{routes,service,repo,draft,submit,review,inbox,scope,dto,uploads,template,alerts,exports,export-build,dsr,search,events,index}.ts
  modules/read-models/{routes,dashboard,attention,today,cache,keys,index}.ts
  modules/tasks/{views.ts or shift-tasks.ts}   # listTasksForPerson (E3), exported from index.ts
  modules/tasks/recurrence.ts    # per_shift materialisation
  modules/files/service.ts       # UploadPolicy purposes + report_%; isScopedPurpose
  modules/settings/service.ts    # reportDueAfterMinutes
  core/middleware/support.ts     # SUPPORT_DENIED_ROUTES additions
  worker.ts                      # registerShiftReports(): shift-reports.deadline (5 min), report.export, report.export-sweep (10 min)
api/test/{route-fixtures.ts,isolation.test.ts}   # resources pattern, assignment, report, reportFile, reportExport + SPECS; HASHED_TABLES; regex
```

## Interfaces locked by this plan

```ts
// @opsdesk/domain/shifts (existing, ported) — additions
occurrenceInstants(p: ShiftPattern, date: string, tenantTz: string): { startAt: number; endAt: number; minutes: number }   // epoch ms, DST-aware (F3)
dueInstant(endAt: number, dueAfterMinutes: number): number                                                                  // endAt + minutes*60_000

// modules/shifts (exported for the reports module, the recurrence job and the read models)
type Occurrence = { userId: string; patternId: string; teamId: string; name: string; shiftDate: string; startAt: Date; endAt: Date; minutes: number }
occurrencesBetween(tx: TenantTx, tenantId: string, tz: string, from: string, to: string, o?: { userIds?: string[] }): Promise<Occurrence[]>   // shift_date in [from, to]
effectiveReporting(tx: TenantTx, tenantId: string, userId: string, teamId: string): Promise<boolean>                          // override ?? team default ?? false
reportDueAfterMinutes(tx: TenantTx, tenantId: string): Promise<number>                                                      // setting or onboarding default

// modules/tasks (E3; exported from index.ts)
type ShiftTaskRow = { taskId: string; ref: string; title: string; status: string; dueAt: Date; evidenceRequired: boolean }
listTasksForPerson(tx: TenantTx, ctx: TaskCtx, personId: string, window: { fromUtc: Date; toUtc: Date }): Promise<ShiftTaskRow[]>  // scope-filtered (D5), any assignee, F9 rule, due asc then ref

// modules/shift-reports
type ReportState = "draft" | "submitted" | "late" | "missing" | "accepted" | "returned"          // from @opsdesk/domain/shift-report
reportScopeOf(c: Context<AppEnv>, tx: TenantTx): Promise<{ scope: ReportAccess; reports: string[]; me: string; drive: boolean }>   // null scope → 404
openReport(c, tx, input: { patternId: string; date: string }): Promise<ReportDto>                // own shift only; idempotent
submitReport(c, tx, id: string, input: { version: number; requestId: string }): Promise<ReportDto>
reviewReport(c, tx, id: string, input: { version: number; decision: "accept" | "return"; comment?: string }): Promise<ReportDto>
runDeadlineJob(_data: unknown, deps: Deps): Promise<void>                                          // "shift-reports.deadline"
type ReportDto = { id: string; key: string; userId: string; patternId: string; shiftName: string; team: string; date: string; start: string; end: string; due: string;
  startAt: string; endAt: string; dueAt: string; status: StoredStatus; state: ReportState; version: number; submissions: number; items: ReportItemDto[]; summary: string; blockers: string;
  unplanned: UnplannedRow[]; extra: Record<string, string>; attachments: { id: string; name: string; kind: "image" | "file"; size: number }[];
  submittedAt: string | null; reviewedAt: string | null; reviewedBy: string | null; comments: { at: string; by: string; text: string }[] }

// modules/read-models
readModelKey(c: Context<AppEnv>, model: string, scopeKey: string, drive: boolean, localDay: string): string
cached<T>(key: string, ttlMs: number, load: () => Promise<T>, now: Date): Promise<T>
bustReadModels(tenantId: string): void

// files (B2) — UploadPolicy.purpose gains "report_attachment"; helper
isScopedPurpose(p: string | null): boolean     // prefix "task_" or "report_"; used by /v1/files, search, webhook fan-out

// events (core/events/types.ts additions; ids only, NOT in the webhook PROJECTION)
"shift.pattern_created" | "shift.pattern_updated" | "shift.pattern_archived"   { patternId }
"shift.assigned" | "shift.unassigned"                                          { assignmentId, patternId, userId }
"shift.reporting_changed"                                                      { teamId | null, userId | null }
"shift.report.submitted"                                                       { reportId, version }
"shift.report.accepted" | "shift.report.returned"                              { reportId, version }
"shift.report.missing"                                                         { userId, patternId, shiftDate }
"report.export_completed"                                                      { exportId }
```

### Error codes (all problem+json)

404: `shift_pattern_not_found`, `shift_assignment_not_found`, `shift_not_found`, `report_not_found`, `report_file_not_found`, `report_export_not_found`, `team_not_found` · 403: `module_not_entitled`, `forbidden`, `self_review`, `human_required`, `device_policy`, `support_forbidden_route` · 409: `version_conflict`, `report_locked`, `report_not_submitted`, `assignment_started`, `team_has_shifts`, `export_limit`, `retry` · 410: `file_infected` · 422: `invalid_pattern`, `invalid_pattern_zone`, `invalid_assignment`, `assignee_out_of_scope`, `report_invalid` (with `errors: [{ key, message }]`), `comment_required`, `item_not_in_shift`, `reporting_off`, `invalid_range`, `range_too_long`, `export_too_large`, `pdf_too_large`, `invalid_repeat` · 400: `invalid_cursor`, `validation_failed` · 402: billing blocked (writes).

---

### Task T5.1: Shift patterns, assignments, reporting settings, occurrence engine, `per_shift` recurrence — **DST subtleties: strongest reviewer on the engine**

**Files:**
- Domain: `shifts.ts` (F2 date fix, `occurrenceInstants`, `dueInstant`), `task-model.ts` / `task-recurrence.ts` (`per_shift`). `lib/` and FE re-exports stay; `packages/domain/src/shifts.test.ts` gains the cases below.
- `db/schema/shifts.ts` + migration `0035_shifts.sql`:
  - `shift_patterns(id uuid pk, tenant_id, team_id uuid not null, name text 1..80, start_time text 'HH:MM', end_time text 'HH:MM', days smallint[] not null (1..7 unique values 0..6), time_zone text null, version int not null default 1, archived_at timestamptz null, created_at, updated_at)`; `unique(tenant_id, id)`; `unique(tenant_id, team_id, name) where archived_at is null`; composite FK `(tenant_id, team_id)` → `teams` (no cascade: team delete → 409 `team_has_shifts`); checks on the HH:MM shape.
  - `shift_assignments(id uuid pk, tenant_id, user_id text, pattern_id uuid, from_date date not null, until_date date null, created_by text null, created_at)`; composite FKs `(tenant_id, user_id)` → memberships (cascade), `(tenant_id, pattern_id)` → shift_patterns; `check(until_date is null or until_date >= from_date)`; overlap per (user, pattern) is refused in the service under `SHIFT_LOCK_NS` (no btree_gist).
  - `shift_reporting_teams(tenant_id, team_id, on boolean, updated_by, updated_at, pk(tenant_id, team_id))`; `shift_reporting_people(tenant_id, user_id, on boolean, updated_by, updated_at, pk(tenant_id, user_id))` (no row = follow the team).
  - Indexes: `shift_assignments_user_idx (tenant_id, user_id, from_date)`, `shift_assignments_pattern_idx (tenant_id, pattern_id)`, `shift_patterns_team_idx (tenant_id, team_id) where archived_at is null`.
  - All tables: R8 policy + FORCE; grants `SELECT, INSERT, DELETE` (assignments: `UPDATE (until_date)`; patterns: `UPDATE (name, team_id, start_time, end_time, days, time_zone, version, archived_at, updated_at)`; reporting tables: `UPDATE (on, updated_by, updated_at)`).
- `modules/shifts/*`; `modules/settings/service.ts` (+`reportDueAfterMinutes`); `modules/tasks/recurrence.ts` (`per_shift`); `modules/teams/service.ts` (map FK `23503` on `shift_patterns` to 409 `team_has_shifts`); `core/events/types.ts`; `modules/notifications/prefs.ts` (+`report`).

**Interfaces:** all routes `requireTenant, requireModule("M1")`, module `shifts`.

| Method + path | Permission | Notes |
|---|---|---|
| `GET /v1/shifts` | `shifts:read` | `{ patterns, assignments, members: [{ userId, teams, managerId }], reporting: { dueAfterMinutes, teamDefaults, overrides } }`; staff-home gets the `ownShiftState` cut (own assignments, their patterns, own override, their teams' defaults, their primary manager) |
| `GET /v1/shifts/occurrences?from&to&userId?` | `shifts:read` | range ≤ 31 days (422 `range_too_long`); each item `{ userId, patternId, name, teamId, shiftDate, start, end, startAt, endAt, minutes, endsNextDay, reportsOn }`; scope: staff own only |
| `POST /v1/shifts/patterns` | `shifts:write`, all-scope | `{ name, teamId, start, end, days, timeZone? }` → 201; `timeZone` must be IANA (`isTimeZone`) else 422 `invalid_pattern_zone` |
| `PATCH /v1/shifts/patterns/{id}` | `shifts:write`, all-scope | `{ version, … }`; 409 `version_conflict` |
| `DELETE /v1/shifts/patterns/{id}` | `shifts:write`, all-scope | archive (F14); open assignments keep their rows but produce no occurrences |
| `POST /v1/shifts/assignments` | `shifts:write` | `{ userId, patternId, from, until? }`; assignee must be an active member holding `reports:read` or `tasks:read` (422 `invalid_assignment`); team-scope: direct reports only |
| `PATCH /v1/shifts/assignments/{id}` | `shifts:write` | `{ until: date \| null }` (the FE "unassign" sets `until`, history kept) |
| `DELETE /v1/shifts/assignments/{id}` | `shifts:write` | only when `from_date` is in the future (409 `assignment_started`) |
| `PUT /v1/shifts/reporting/teams/{teamId}` | `shifts:write`, all-scope | `{ on }` |
| `PUT /v1/shifts/reporting/people/{userId}` | `shifts:write` | `{ on: boolean \| null }`; `null` = use the team default; team-scope: direct reports only |
| `PATCH /v1/settings/organisation` | `settings:write` | + `reportDueAfterMinutes` (0–1440, 422 `invalid_report_due`) |

Occurrence engine (`occurrences.ts`): for each date in the range, each non-archived pattern whose `days` contains the pattern-local weekday and each assignment covering that date → `occurrenceInstants`. Effective reporting is `override ?? team default ?? false`, read with the **shift's** team (a member on two teams).

- [ ] **Step 1: Failing tests** (`packages/domain/src/shifts.test.ts`, `modules/shifts/shifts.test.ts`, `modules/tasks/recurrence.test.ts`)

```ts
test("shift windows across both DST changes (Europe/Dublin, pattern 22:00-06:00)", () => {
  // Sat 24 Oct 2026 starts 21:00Z, ends Sun 25 Oct 06:00Z: 540 min (9 h), shiftDate 2026-10-24
  // Sun 25 Oct 2026 starts 22:00Z, ends Mon 06:00Z: 480 min, shiftDate 2026-10-25
  // Sat 27 Mar 2027 starts 22:00Z, ends Sun 28 Mar 05:00Z: 420 min (7 h), shiftDate 2027-03-27
  expect(dueInstant(occurrenceInstants(night, "2026-10-24", tz).endAt, 60)).toBe(Date.parse("2026-10-25T07:00:00Z")) // not 05:00Z, not 06:00Z
})
test("an end time inside the repeated hour takes the earlier instant: pattern 18:00-01:30 on Sat 24 Oct ends 2026-10-25T00:30Z, due 01:30Z (not the second 01:30)", () => {})
test("a start inside the spring-forward gap moves forward: pattern 01:30-09:30 on Sun 28 Mar 2027 starts 01:30Z (wall 02:30), 420 min", () => {})
test("a pattern in Pacific/Auckland keeps its own start date: shiftDate is the Auckland date, and shiftsOn/occurrencesBetween/shiftKey agree (F2)", () => {})
test("tenant in Pacific/Auckland: the same patterns give the same real durations on 27 Sep 2026 and 5 Apr 2027", () => {})
test("occurrencesBetween honours days, from/until inclusive, archived patterns and a member on two teams (reporting read with the shift's team)", async () => {})
test("reporting: override beats team default; null override follows the team; AC-M1-01 reporting on for 3 of 5 members gives 3 reporting occurrences", async () => {})
test("staff GET /v1/shifts returns only own assignments, their patterns, own override, team defaults, primary manager (no other person's id)", async () => {})
test("team-scope manager assigns a direct report (201) but not another team's member (422 assignee_out_of_scope); a pattern POST is 403; team default PUT is 403", async () => {})
test("assignment overlap for the same user and pattern is 422 invalid_assignment, also under 10 concurrent POSTs (one wins)", async () => {})
test("DELETE of a started assignment is 409 assignment_started; PATCH until keeps history", async () => {})
test("pattern PATCH with a stale version is 409 version_conflict; archived pattern yields no occurrences but keeps old reports' pattern", async () => {})
test("deleting a team that has patterns is 409 team_has_shifts", async () => {})
test("reportDueAfterMinutes default comes from the onboarding data file, PATCH validates 0..1440 and is audited", async () => {})
test("per_shift series: one instance per occurrence of the pattern for the primary assignee; start = shift start, due = shift end; Sat 24 Oct night due 2026-10-25T06:00Z; unique per shift_date; 7-day catch-up", async () => {})
test("per_shift without patternId, or with an archived pattern, is 422 invalid_repeat", async () => {})
test("every shift route: another tenant's pattern, assignment, team or user id → 404 with the resource code; no cross-tenant write", async () => {})
test("removing M1 → 403 module_not_entitled within 60 s; rows untouched", async () => {})
test("RLS: a tenant-A tx cannot read or insert tenant-B shift rows (error on .cause); app_user cannot DELETE shift_patterns", async () => {})
test("shift events carry ids only and none is in WEBHOOK_EVENT_TYPES", async () => {})
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Port, do not rewrite: `occurrenceInstants` wraps the existing `wallToEpoch`; keep `shiftWindow` for the FE and fix its `date`. Add the `ROUTE_PARAMS` / `SPECS` entries (`/v1/shifts/patterns/{id}`, `/assignments/{id}`, `/reporting/teams/{teamId}`, `/reporting/people/{userId}`; expect `shift_pattern_not_found`, `shift_assignment_not_found`, `team_not_found`, `not_a_member`), the `pattern` and `assignment` resources in `route-fixtures.ts`, and the new tables in `HASHED_TABLES` and the meta-test regex.
- [ ] **Step 4:** Run → PASS (also `isolation.test.ts`, `rls-guard.test.ts`, the domain and FE suites).
- [ ] **Step 5:** Commit `feat(api): shift patterns, assignments, reporting settings and per-shift recurrence`.

### Task T5.2: Shift reports, member side: rows, draft, submit, versions, uploads, `listTasksForPerson` — **security- and concurrency-sensitive: strongest reviewer**

**Files:**
- `modules/tasks/shift-tasks.ts` (`listTasksForPerson`, exported from `index.ts`).
- `db/schema/shift-reports.ts` + migration `0036_shift_reports.sql`:
  - `shift_reports(id uuid pk, tenant_id, user_id text null, pattern_id uuid, shift_date date, team_id uuid, shift_name text, start_at, end_at, due_at timestamptz, status text check in ('draft','submitted','accepted','returned'), summary text ≤ 4000, blockers text ≤ 2000, unplanned jsonb, extra jsonb, first_submitted_at, submitted_at, reviewed_at timestamptz null, reviewed_by text null, version int not null default 1, submissions int not null default 0, created_at, updated_at)`; `unique(tenant_id, user_id, pattern_id, shift_date)`; `unique(tenant_id, id)`; composite FKs `(tenant_id, user_id)` → memberships (`ON DELETE SET NULL (user_id)`, written by hand in the migration), `(tenant_id, pattern_id)` → shift_patterns, `(tenant_id, team_id)` → teams.
  - `shift_report_items(tenant_id, report_id, position smallint, task_id uuid null, task_ref int, title text, due_at timestamptz, status text check in ('done','in_progress','blocked','not_started'), minutes int 0..1440, note text ≤ 1000, pk(report_id, position))`; FK `(tenant_id, report_id)` cascade; `(tenant_id, task_id)` → tasks `ON DELETE SET NULL (task_id)`; row is kept for purged tasks.
  - `shift_report_versions(id, tenant_id, report_id, v int, at timestamptz, by_user text null, request_id uuid, note text, snapshot jsonb, unique(report_id, v), unique(report_id, request_id))`.
  - `shift_report_comments(id, tenant_id, report_id, at, by_user text null, kind text check in ('return','accept'), text ≤ 2000)`; `shift_report_files(file_id uuid pk, tenant_id, report_id uuid, user_id text null, created_at)` with FK `(tenant_id, file_id)` → files.
  - Indexes: `shift_reports_inbox_idx (tenant_id, shift_date desc, id)`, `shift_reports_user_idx (tenant_id, user_id, shift_date desc)`, `shift_reports_open_idx (tenant_id, due_at) where status in ('draft','returned')`, `shift_report_items_task_idx (tenant_id, task_id) where task_id is not null`, `shift_report_comments_report_idx (tenant_id, report_id, at)`.
  - Grants: `shift_reports`: SELECT, INSERT, `UPDATE (status, summary, blockers, unplanned, extra, first_submitted_at, submitted_at, reviewed_at, reviewed_by, version, submissions, updated_at)`; `shift_report_items`: SELECT, INSERT, UPDATE (status, minutes, note, title), DELETE; versions and comments: **SELECT, INSERT only** (immutable); files: SELECT, INSERT.
- `modules/shift-reports/{routes,service,repo,draft,submit,scope,dto,uploads,dsr,events,index}.ts`; `modules/files/service.ts` (`report_attachment` policy, `isScopedPurpose`); `modules/gdpr` (register the shift-reports handler, F22); `core/middleware/support.ts` (F21).

**Interfaces:** routes `requireTenant, requireModule("M1")`, module `reports`.

| Method + path | Permission | Notes |
|---|---|---|
| `GET /v1/shift-reports/current` | `reports:read` | `{ item: { key, shiftName, shiftDate, startAt, endAt, dueAt, state, reportId \| null } \| null }`: the running shift's, else the last ended one with no submission (`reportPromptFor` port, instants not wall strings) |
| `POST /v1/shift-reports/open` | `reports:write` | `{ patternId, date }` → get-or-create the caller's OWN draft, rows from `listTasksForPerson`; no assignment → 404 `shift_not_found`; reporting off for the shift's team and no existing row → 422 `reporting_off` |
| `GET /v1/shift-reports/{id}` | `reports:read` | F5 scope; 404 `report_not_found` otherwise; rows show live task state + `evidenceState` (F11) |
| `PUT /v1/shift-reports/{id}/draft` | `reports:write`, owner only | `{ version, items: [{ taskId, status, minutes, note }], summary, blockers, unplanned, extra, attachmentFileIds }`; status `draft` or `returned` else 409 `report_locked`; items must be in the shift's task set (422 `item_not_in_shift`); limits: summary ≤ 4000, blockers ≤ 2000, ≤ 20 unplanned rows (text ≤ 300, minutes 0–1440), ≤ 5 attachments, ≤ 50 extra answers ≤ 2000 chars, row note ≤ 1000, minutes 0–1440; bumps `version` |
| `POST /v1/shift-reports/{id}/submit` | `reports:write`, owner only, human | `{ version, requestId }` (F7) |
| `GET /v1/shift-reports/{id}/versions` | `reports:read` | F5 scope; `[{ v, at, by, note, snapshot }]`, the same Drive withholding |
| `POST /v1/shift-reports/{id}/uploads` · `POST …/uploads/{fileId}/complete` · `GET …/files/{fileId}/download` | `reports:write` owner / `reports:read` scope | purpose `report_attachment`, B2 mime list, 5 per report; download = 60 s presigned GET, 409 `file_not_ready`, 410 `file_infected`; never via `/v1/files` |

`submitReport` order (F7, lock order): `lockActor(..., "reports", "write")` → report `FOR UPDATE` → `select id from tasks where id = any(rowTaskIds) order by id for update` → template validation (`validateReport` port, template from T5.3's store with the onboarding default) → one `applyTaskUpdate` per row with ids `<reportId>.v<n>.<ref>` and delta minutes (F8) → insert version (+ unique `requestId`) → update report → notify the manager(s) in scope (`report` kind, body = shift name and date) → `publish("shift.report.submitted")` last.

- [ ] **Step 1: Failing tests** (`modules/shift-reports/reports.test.ts`, `modules/tasks/shift-tasks.test.ts`)

```ts
test("listTasksForPerson: any assignee, not archived or cancelled, starts before window end, not finished before window start; due asc then ref", async () => {})
test("listTasksForPerson respects task scope: a team manager passing an out-of-team personId gets []; staff passing someone else gets [] (D5, subjectUserId for an api key = its creator)", async () => {})
test("report rows and deadline for the 24 Oct night: window 21:00Z-06:00Z; a task completed 2026-10-25T00:30Z (01:30 BST) and one at 01:30Z (01:30 GMT) are both in; one completed 20:59Z is out; due_at 07:00Z", async () => {})
test("open creates the draft once: two concurrent opens return the same id (unique key), 201 then 200", async () => {})
test("open for a shift the caller is not assigned to, another member's shift, or another tenant's pattern → 404 shift_not_found; reporting off → 422 reporting_off", async () => {})
test("AC-M1-02: the report lists exactly the member's shift tasks and submitting updates them (status, time entry, history line)", async () => {})
test("submit is atomic and idempotent: same requestId twice → one version and one set of history lines (200 both); a failing row rolls back every row and the version", async () => {})
test("concurrent submit with different requestIds at the same version: one 200, one 409 version_conflict", async () => {})
test("resubmit after a return creates v2 and logs only the extra minutes (30 → 45 logs 15); status never moves a task backwards", async () => {})
test("pending scan never fails a report: Required task with a pending file stays open, row outcome needs_evidence, history 'Report marked done; evidence still needed'; infected file auto-rejected (T4.6 path)", async () => {})
test("Required task with a clean accepted-ready item goes to submitted_for_review; Not-needed task goes to completed; evidence state is returned read-only per row", async () => {})
test("submitted or accepted report rejects PUT draft and submit: 409 report_locked; returned allows both", async () => {})
test("template validation: required summary missing → 422 report_invalid with errors[{key:'summary'}]; blocked row without a note → key 'item:TSK-1001:note'", async () => {})
test("an item whose taskId is not in the shift's tasks, or belongs to tenant B → 422 item_not_in_shift", async () => {})
test("Drive text is withheld per request: summary, blockers, notes, unplanned, extra and row titles show 'Google Drive link' off the company PC, intact on it; notification bodies hold no report text", async () => {})
test("an api key (staff creator) can GET own report and PUT draft but submit → 403 human_required", async () => {})
test("support grant: GET /v1/shift-reports/{id} → 403 support_forbidden_route (audited)", async () => {})
test("attachments: upload via the report intent, 6th → 422; another report's fileId → 404 report_file_not_found; /v1/files/{id} → 404 for purpose report_attachment; no file.* webhook delivery is created for it", async () => {})
test("two lock-order deadlock attempts (submit vs a manager PATCH of the same task) end in 200 + 409 retry or two 200s, never a 500", async () => {})
test("submit p95: a report with 30 rows submits in < 2 s (NFR-08)", async () => {})
test("DSR erase nulls user_id, replaces free text with [erased], expires attachments; DSR export lists the subject's reports", async () => {})
test("RLS: tenant-A tx cannot read or insert tenant-B shift_reports/items/versions; app_user cannot UPDATE shift_report_versions or DELETE shift_report_comments (grant test)", async () => {})
test("removing M1 → 403 within 60 s; data kept", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL. Implement. Add SPECS for `/v1/shift-reports/{id}`, `/draft`, `/submit`, `/versions`, `/uploads`, `/uploads/{fileId}/complete`, `/files/{fileId}/download` (resources `report`, `reportFile`; codes `report_not_found`, `report_file_not_found`), new tables to `HASHED_TABLES`, and an EXPLAIN test that `listTasksForPerson` uses `task_assignees_user_idx` then `tasks_live_due_idx`. PASS. Commit `feat(api): shift reports with versions, atomic submit and task updates`.

### Task T5.3: Inbox, accept / return, template, search — **scope and independence: strongest reviewer**

**Files:** `modules/shift-reports/{inbox,review,template,search,scope}.ts`; migration part of `0036` is reused (no new table: the template is the tenant setting `report_template`, validated JSON); `modules/search/subscribers.ts` (reports as documents).

**Interfaces:**

| Method + path | Permission | Notes |
|---|---|---|
| `GET /v1/shift-reports` | `reports:read` | filters `from`, `to` (default last 7 tenant-local days, range ≤ 31 days for the merged inbox, 422 `range_too_long`), `team` (teamId), `person` (userId), `status` (`all\|draft\|submitted\|late\|missing\|accepted\|returned`); keyset `(shift_date desc, user_id, pattern_id)`; items `{ id \| null, key, …ReportDto summary fields without free text }`. **Virtual rows** (assigned, reporting on, no row) are merged in for `all`, `draft`, `missing` and shown with `id: null`; scope applied to both |
| `POST /v1/shift-reports/{id}/accept` | `reports:write`, manager-home, human | `{ version, comment? }` → `accepted`; reviewer = actor |
| `POST /v1/shift-reports/{id}/return` | same | `{ version, comment }` → `returned`; member edits and resubmits |
| `GET /v1/shift-reports/template` | `reports:read` | templates for the teams in the caller's scope (default from onboarding data when unset) |
| `PUT /v1/shift-reports/template` | `settings:write` | whole `TemplateData` (`departments[{ dept, sections[{ id, title, enabled, fields[{ id, label, required }] }] }]`; ≤ 12 sections, ≤ 12 fields, ids `[a-z0-9_]{1,40}`); applies to new submissions only; audited |

State at read time (F9, F3): `reportState` over instants and `deps.clock`; `late` = `first_submitted_at > due_at`, never changed by resubmits.

- [ ] **Step 1: Failing tests**

```ts
test("report scope: staff see only their own reports; team manager sees direct reports and own, not an indirect report and not another team; owner sees all; out of scope → 404 report_not_found on GET, accept, return, versions, uploads", async () => {})
test("inbox returns nothing outside scope even with person= or team= filters naming others (empty, not 403)", async () => {})
test("AC-M1-03: a submitted report is in the manager's inbox at once; a missing one (virtual row, no report row) is flagged after due_at, and 'late' when submitted afterwards", async () => {})
test("inbox filters by date, team, person and status; virtual rows page correctly across two pages (keyset, no duplicates or gaps)", async () => {})
test("nobody reviews their own report: owner and manager → 403 self_review on accept and return; nothing changes", async () => {})
test("accept and return only from submitted (409 report_not_submitted); return needs a comment (422 comment_required); stale version 409 version_conflict; concurrent accept and return at one version: one wins", async () => {})
test("a manager without reports:write, a staff role, and an api key → 403 forbidden / human_required on accept and return", async () => {})
test("member is notified on accept and on return (kind 'report', body without report text); history of versions keeps both", async () => {})
test("accept and return are audited (report.accepted / report.returned, ids and decision only); submit and draft saves are not", async () => {})
test("template: PUT needs settings:write; GET is scoped to the teams in the caller's scope; submit validates against the template in force at submit time; unknown section ids → 422", async () => {})
test("search finds a report by shift name and date within scope (own / team / all), never by free text; archived is n/a", async () => {})
test("Drive text withheld in inbox and detail for an Android session (per request, FR-M0-10)", async () => {})
test("inbox query uses shift_reports_inbox_idx / shift_reports_user_idx (EXPLAIN); assignment scan uses shift_assignments_user_idx", async () => {})
test("every report route: tenant B's report id → 404 report_not_found with A's cookie, no write", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL. Implement (`reportScopeOf` is the only place scope is computed; accept/return reuse the T4.6 independence pattern). SPECS for `/accept`, `/return`. Commit `feat(api): report inbox, accept and return with comment, report template`.

### Task T5.4: Deadline job: shift-end prompt and "missing at deadline" alerts — **concurrency and DST: strongest reviewer**

**Files:** migration `0037_report_alerts_exports.sql` (the `shift_report_alerts` part; the `report_exports` part is T5.5); `modules/shift-reports/alerts.ts`; `worker.ts` (`shift-reports.deadline` scheduler every 5 min).

- `shift_report_alerts(id, tenant_id, user_id text, pattern_id uuid, shift_date date, kind text check in ('prompt','missing'), alerted_at timestamptz, `unique(tenant_id, user_id, pattern_id, shift_date, kind)`); composite FK `(tenant_id, pattern_id)`; grants SELECT, INSERT only; no FK to `shift_reports` (a missing alert has no report row).
- Job `shift-reports.deadline` `{}`: for each `active` tenant entitled to M1 and not `blocked` (C13/C14), `now = deps.clock.now()`:
  1. Candidate shifts = occurrences with `shift_date` in `[local today − 3, today]` (the 48 h window plus the longest night) whose `end_at ≤ now`.
  2. Keep those whose effective reporting is on and whose member is an active member.
  3. **prompt**: `end_at ≤ now < due_at` and no submission → ledger `ON CONFLICT DO NOTHING RETURNING`; on insert, `notify(member, "report", "Shift report due", "<shift name>, <date>. Due <HH:mm>")`.
  4. **missing**: `due_at ≤ now`, `due_at > now − 48 h`, and no report row with `first_submitted_at` set → ledger insert; on insert notify the member and the manager (`subjectUserId` + `{{subject}}` body for the manager so no name is stored), publish `shift.report.missing`.
  5. One tx per (tenant, member), `withTenantAfterCommit`; lock order: no advisory lock, ledger insert is the arbiter; notifications written after the insert in the same tx.
- Enqueue of any follow-up uses `sha256` job ids (no `:`).

- [ ] **Step 1: Failing tests** (`modules/shift-reports/alerts.test.ts`, fake clock stepping every 5 min)

```ts
test("shift deadline across DST: Sat 24 Oct 2026 night (22:00-06:00 Dublin) sends prompt at 06:00Z and missing at 07:00Z, not 06:00Z or 05:00Z", async () => {})   // Review Focus #2
test("March night (Sat 27 Mar 2027): prompt at 05:00Z, missing at 06:00Z; Sun 25 Oct night (normal 8 h): prompt 06:00Z next day, missing 07:00Z", async () => {})
test("two workers and the repeated hour send each alert exactly once: shift 18:00-01:30 on 24 Oct, clock stepped 5 min from 2026-10-24T23:00Z to 2026-10-25T04:00Z, runDeadlineJob x2 in parallel per tick → one prompt (at 00:30Z) and one missing (at 01:30Z) per member and manager", async () => {})   // Review Focus #5
test("a retried job after a crash between tenants repeats nothing: ledger rows are unique per (member, shift, day, kind)", async () => {})
test("a submitted report (any time before due) means no missing alert; a report submitted after due after the alert is 'late' and sends nothing more", async () => {})
test("member and primary manager both get 'missing'; no manager → active owners get it; manager body holds no name until read ({{subject}})", async () => {})
test("reporting turned off after the shift ended sends nothing; due-after setting 90 shifts the instant; a member removed or suspended gets nothing", async () => {})
test("lookback is 48 h: a shift whose due time is 49 h old is not alerted and still shows 'missing' in the inbox", async () => {})
test("job skips suspended tenants (C14), tenants without M1 and billing-blocked tenants (C13); re-enabling resumes without a flood", async () => {})
test("a failure in tenant 1 does not stop tenant 2 (per-tenant try/catch); logs carry ids and error codes only", async () => {})
test("two time zones in one run: Dublin and Auckland tenants each alert at their own due instant", async () => {})
test("job uses deps.clock only; no DB now(); enqueue job ids are 64-hex with no ':'", async () => {})
test("RLS and grants: app_user cannot UPDATE or DELETE shift_report_alerts; tenant-A tx cannot insert tenant-B ledger rows", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL. Implement; register in `worker.ts` (`registerShiftReports()`). Commit `feat(api): shift-end prompt and missing-report alerts as an exactly-once job`.

### Task T5.5: Report exports (PDF, Excel, CSV) as jobs to Files — **privacy-sensitive: strongest reviewer**

**Files:** migration `0037` (the `report_exports` part); `modules/shift-reports/{exports,export-build}.ts`; `packages/domain/src/report-export.ts`; `modules/files/service.ts` (`storeGeneratedFile` purpose union + `report_export`; `isScopedPurpose` at the three call sites); `api/package.json` (exceljs, jspdf, jspdf-autotable); `worker.ts` (`report.export`, `report.export-sweep`).

- `report_exports(id uuid pk, tenant_id, requested_by text, format text check in ('pdf','xlsx','csv'), filters jsonb, report_id uuid null, status text check in ('queued','running','done','failed'), file_id uuid null, row_count int null, error_code text null, claimed_until timestamptz null, created_at, started_at, completed_at, expires_at)`; composite FKs to memberships and files; index `report_exports_user_idx (tenant_id, requested_by, created_at desc)`, `report_exports_sweep_idx (status, created_at) where status in ('queued','running')`; grants `SELECT, INSERT, UPDATE (status, file_id, row_count, error_code, claimed_until, started_at, completed_at)`.

| Method + path | Permission | Notes |
|---|---|---|
| `POST /v1/report-exports` | `reports:read`, human | `{ format, reportId? , from?, to?, team?, person?, status? }` → **202** `{ id }`; one report (`reportId`, F5 scope, else 404 `report_not_found`) or a range (≤ 92 days); 409 `export_limit` (3 active); audit `report.export_requested` in the same tx; enqueue after commit |
| `GET /v1/report-exports/{id}` | requester only | `{ id, status, format, rowCount, expiresAt, errorCode }`, else 404 `report_export_not_found` |
| `GET /v1/report-exports/{id}/download` | requester only | 302 to a 60 s presigned GET; 409 `export_not_ready`; 404 after expiry |

Job `report.export` `{ exportId, tenantId }` (job id `sha256("report.export|<tenant>|<exportId>|<attempt>")`): claim `queued → running` with a lease (`claimed_until`); **re-resolve the requester's membership, role and scope now** (a downgrade fails the export with `forbidden`); read reports in pages of 200 under that scope; build rows with the shared builder; encode (CSV with BOM via `csvCell`; XLSX via `exceljs`; PDF via `jspdf-autotable`); `storeGeneratedFile` with a deterministic file id from the export id (a re-run overwrites the same key, no orphans), purpose `report_export`, name per F16; one tx marks `done`, audits `report.exported` `{ format, rowCount, range }`, notifies the requester (`report`, no PII), publishes `report.export_completed`. Failure → `failed` + code, an uncommitted object is removed (as `dropUncommittedExport`). `report.export-sweep` (10 min): re-enqueues `queued` older than 2 min and `running` past the lease with nonce job ids, and **expires `done` exports older than 7 days** (`expireFile`), so expiry survives a Redis loss.

- [ ] **Step 1: Failing tests** (`modules/shift-reports/exports.test.ts`, `packages/domain/src/report-export.test.ts`)

```ts
test("CSV formula injection: summary '=HYPERLINK(\"http://x\")', '+1', '-2', '@SUM(A1)', tab and CR starts all come out prefixed with ' and quoted; BOM present; RFC 4180 quoting for commas, quotes and newlines", () => {})
test("file names hold no personal data: range 'shift-reports-2026-10-19-2026-10-25-team.csv', single 'shift-report-1a2b3c4d.pdf'; the stored files.name and the download name never contain the member's name or email", async () => {})
test("export re-checks scope in the job: a team manager's export holds only direct reports' rows; if the requester's role is downgraded before the job runs the export is failed with forbidden and no file exists", async () => {})
test("export rows equal the inbox rows for the same filters (status derived with deps.clock and tenant tz, times in tenant time); free text passes withholdDriveText", async () => {})
test("range over 92 days → 422 range_too_long; more than 5000 reports or 50000 rows → 422 export_too_large; PDF over 500 reports → 422 pdf_too_large; all before any job is queued", async () => {})
test("large report: 4000 reports x 10 rows exports as CSV and XLSX in pages of 200 without holding more than one page of DB rows (assert page count) and under 25 MiB", async () => {})
test("only the requester downloads: another member of the same scope, an owner, a support grant and an api key all get 404 / 403; the download URL expires in 60 s", async () => {})
test("API keys cannot request exports (403 human_required) and the route matches EXPORT_OR_DOWNLOAD", async () => {})
test("job is idempotent: running it twice (two workers) produces one file row, one notification and one audit row; a crash after the object write leaves no orphan object", async () => {})
test("a report_export file is hidden from /v1/files (404), not in search, and produces no webhook delivery for file.* events (fail closed)", async () => {})
test("sweep re-enqueues a lost queued export and expires a 7-day-old file; expired download → 404", async () => {})
test("export_limit: a 4th active export → 409 export_limit", async () => {})
test("PDF and XLSX open: the XLSX has one sheet per table with the same cells as the CSV; the PDF has a header with the tenant name from settings and the tenant-time timestamp", async () => {})
test("jobs skip suspended, M1-less and blocked tenants; export audit holds the format and count, never names", async () => {})
test("every export route: tenant B's export or report id → 404 with the resource code", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL. Implement. SPECS for `/v1/report-exports/{id}` and `/download` (resource `reportExport`). Commit `feat(api): shift report exports as jobs to Files`.

### Task T5.6: Read models: dashboard, attention, Today, staff dashboard, cache

**Files:** `modules/read-models/*`; migration `0038_read_model_indexes.sql`; `modules/shift-reports/scope.ts` reused.

- Indexes (named, each backed by an EXPLAIN test): `tasks_closed_idx (tenant_id, completed_at desc) where archived_at is null and completed_at is not null` (tasks closed per day), existing `tasks_live_due_idx`, `tasks_live_status_due_idx`, `task_assignees_user_idx`, `task_evidence_gallery_idx (tenant_id, review, created_at, id)` for "evidence awaiting review", plus `shift_reports_open_idx` and `shift_reports_inbox_idx` (T5.2). Add `task_evidence_pending_idx (tenant_id, task_id) where review = 'pending'` only if the EXPLAIN test shows the gallery index is not used for the pending count. No table is added.

| Method + path | Permission | Notes |
|---|---|---|
| `GET /v1/dashboard` | `dashboard:read` | manager home bundle in scope: `summary` (open, overdue, due today, completed today with 7-day trend, awaiting review), `tasksClosed` (last 7 tenant-local days: count, late, top closer), `progress` (status mix), `reportDeadline` (`memberDeadline` / `teamDeadline` port, instants), `attentionCount` |
| `GET /v1/dashboard/team-tasks` | `tasks:read` | cursor list of open tasks in scope (`limit`, `cursor`), the FE table |
| `GET /v1/dashboard/staff` | `dashboard:read` | the member's own: `myTasks` (open / overdue / review / returned + list), `evidence` (awaiting review, returned with reason), `comments` (latest on own tasks), `reportDeadline` |
| `GET /v1/attention` | `attention:read` | FR-M1-79 feed in scope (F17): overdue, blocked, evidence awaiting review, missing and returned reports; each `{ kind, ref \| reportId, title, ownerId, dueAt, reason }`; cursor |
| `GET /v1/today` | `tasks:read` | `{ counts: TodayCounts, workingDay: { startsAt }, order: DayItem[] (mode query), summary: DaySummary, team?: TeamOverdue (manager), reports: n }`; counts are tasks the caller may see (FR-M1-80) |
| `POST /v1/today/updates` | `tasks:write`, human for done | `{ taskId, action: "done" \| "snooze", dayKey }` → `applyTaskUpdate` with the `todayUpdate` id; out of scope or another tenant's task → 404 `task_not_found`; busts the cache |

All dates are tenant-local day boundaries: `[localMidnight(d), localMidnight(d+1))` as UTC instants via `wallToEpoch`, so a 23-hour or 25-hour day (25 Oct 2026, 28 Mar 2027) counts correctly. Cache per F18 (TTL 30 s). Working-day start for Today = first shift start of the day in the member's occurrences, else the `DEFAULT_DAY_START` data (FR-M1-70).

- [ ] **Step 1: Failing tests** (`modules/read-models/read-models.test.ts`)

```ts
test("dashboard counts follow scope: staff own, team manager own + direct reports, owner all; the same numbers as the task list with the same filters", async () => {})
test("'due today' and 'closed per day' use the tenant-local day: on 25 Oct 2026 (25 h day) a task completed 2026-10-25T23:30Z counts on the 26th for Dublin and the 26th/27th boundary for Auckland; on 28 Mar 2027 (23 h day) the day holds 23 hours of completions", async () => {})
test("cache never crosses tenants or scopes: owner A caches the dashboard, staff B in the same tenant gets staff numbers; manager of team X then manager of team Y get their own; Drive-withheld and full titles are separate entries; keys all start 'rm:<tenantId>:'", async () => {})
test("a task or report change by this instance busts that tenant's cache; without a write the entry lives 30 s of fake-clock time then reloads", async () => {})
test("removing M1 → 403 even when a cached entry exists (the guard runs before the cache)", async () => {})
test("support sessions are never cached and are 403 on /v1/today (F21)", async () => {})
test("attention feed lists overdue, blocked, evidence awaiting review, missing and returned reports in scope only; an out-of-scope task or report never appears; archived tasks never appear", async () => {})
test("Today counts equal the FE todayCounts rules; 'play my day' order is overdue, high today, then rest (dayOrder port); reports count = returned + missing for the member; lock-screen safe: counts only in the notification path", async () => {})
test("POST /v1/today/updates done on a Required task keeps it open ('evidence still needed'); snooze writes only a history line; a repeat with the same dayKey is idempotent; tenant B's taskId → 404 task_not_found", async () => {})
test("staff dashboard returns only the caller's tasks, evidence and comments (an api key: its creator's)", async () => {})
test("team-tasks cursor pages without duplicates; bad cursor → 400 invalid_cursor", async () => {})
test("EXPLAIN: summary, tasks-closed, team-tasks, attention and evidence-awaiting queries use tasks_live_due_idx / tasks_live_status_due_idx / tasks_closed_idx / task_assignees_user_idx / task_evidence_gallery_idx / shift_reports_open_idx (no Seq Scan on tasks or task_evidence at 10 000 tasks)", async () => {})
test("read models answer in < 500 ms uncached at 250 users and 10 000 tasks (median of 10 runs on the seeded tenant, p95 ceiling 500 ms; the k6 run is B7)", async () => {})
test("all read-model routes carry ROUTE_PARAMS-free walker coverage: GET routes without params are walked by tenantGetRoutes and return only the caller's tenant", async () => {})
```

- [ ] **Step 2–5:** Run → FAIL. Implement. Commit `feat(api): dashboard, attention, Today and staff read models with a scoped cache`.

---

## Requirement coverage

| Requirement | Task |
|---|---|
| FR-M1-20 patterns (name, start, end, days, zone) and assignments | T5.1 |
| FR-M1-21 reporting on/off per member, team default (Q5, AC-M1-01) | T5.1 |
| FR-M1-22 prompt at shift end (PC and Android: in-app and push via `report` kind) | T5.4 (`current` route in T5.2) |
| FR-M1-23 report pre-filled with the shift tasks, status / time / note (AC-M1-02) | T5.2 |
| FR-M1-24 summary, blockers, unplanned work, attachments | T5.2 |
| FR-M1-25 template: extra and required fields; deadline after shift end (Q7) | T5.3 (template), T5.1 (due-after setting) |
| FR-M1-26 submit updates task statuses and time entries | T5.2 (F8, F11) |
| FR-M1-27 locked once submitted; return to change | T5.2, T5.3 |
| FR-M1-28 inbox per person and shift; filters (AC-M1-03) | T5.3 |
| FR-M1-29 accept or return with comment; member notified | T5.3 |
| FR-M1-30 missing at deadline: alert member and manager | T5.4 |
| FR-M1-31 export to PDF and CSV (and Excel, as the FE) | T5.5 |
| FR-M1-48 evidence in the member's shift report | T5.2 (F11) |
| FR-M1-55 offline draft (Android) | server side only: `requestId` idempotent submit and draft PUT make the client queue safe (T5.2); app is out of scope |
| FR-M1-61 team summary: done, blocked, missing proof, missing reports | T5.6 (attention, dashboard `reportDeadline`) |
| FR-M1-62 overdue / urgent flags (rules-based) | T5.6 (attention, Today order) |
| FR-M1-70..72, 75, 79, 80 Today card, summary, order, manager version, privacy | T5.6 (`/v1/today`); FR-M1-73/74 player is client-side, quick actions via `POST /v1/today/updates` |
| FR-M1-78 auto-card switch | client cookie, not backend |
| FR-M1-81 briefing metrics (Could) | not built |
| D11 `per_shift` recurrence | T5.1 (F15) |
| E3 `listTasksForPerson` | T5.2 |
| Review Focus #2 (DST) and #5 (duplicate jobs) | T5.1, T5.2, T5.4 |

## Done criteria for B5

- Every FR in the table has a passing test; AC-M1-01, AC-M1-02 and AC-M1-03 pass as API tests; AC-M1-06 holds for report text.
- All five Review Focus tests pass. The DST tests pass for Sat 24 → Sun 25 Oct 2026 and Sat 27 → Sun 28 Mar 2027 in `Europe/Dublin`, and for a `Pacific/Auckland` tenant.
- The alert job sends exactly one `prompt` and one `missing` per (member, shift, day) with two workers and the repeated hour; it skips suspended, M1-less and blocked tenants and uses `deps.clock` only.
- Isolation walker green with `ROUTE_PARAMS` + `SPECS` for every new path-param route (pattern, assignment, report, reportFile, reportExport); the meta-test regex now covers `shift_*` and `report_*`, and all eleven new tables are in `HASHED_TABLES`; RLS guard and the grant tests are green.
- Scope is the D5 rule everywhere (tasks, reports, search, read models); out of scope is 404 with no oracle; API-key behaviour covered (`subjectUserId`, `human_required` on submit, review and export).
- `report_export` and `report_attachment` files are invisible to `/v1/files`, search and webhooks; shift and report events are not in the webhook allow-list.
- EXPLAIN tests show the named indexes for the inbox, report rows, assignment scan, dashboard, attention and Today queries; the read-model timing test is under 500 ms.
- FE Vitest suites for `features/shifts`, `features/reports`, `features/dashboard` and `packages/domain` stay green after the port (shims only). `.claude/docs/features/shifts.md` and `shift-reports.md` get a "Backend" note with the route list and rulings F2, F3, F5, F7 for B6.

## Notes for B6 (front-end adapter)

- The report scope is one level (F5); the FE seed and `teamOf` should match. `GET /v1/shift-reports` returns virtual rows with `id: null` and a `key`; open them with `POST /v1/shift-reports/open`.
- Send `version` on draft, submit, accept and return, and a fresh `requestId` per submit attempt (reuse it on retry). `409 retry` can come from any write: repeat once.
- The FE shows wall strings; the DTO also carries `startAt`, `endAt`, `dueAt` instants. Compare instants, never wall strings, around 25 Oct and 28 Mar.
- Attention "decide" and "outstanding" stay mock until B11 (F17); coverage and expiring documents until B8/B11.
