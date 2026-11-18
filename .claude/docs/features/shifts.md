# Shifts (`/shifts`): Phase 1 step 1

SRS: FR-M1-20 (patterns + assignments), FR-M1-21 (reporting on/off per member or team), FR-M1-22 (prompt at shift end: hook only),
FR-M0-07 (teams and reporting lines), CR-01. Open questions built on the SRS assumptions:

| Q | Built as |
| --- | --- |
| Q5 | Reporting is per person with a team default. A member follows their team default unless they have an override. |
| Q7 | The report is due `reportDueAfterMinutes` after shift end (tenant data, seed 60). Member and manager are alerted (step 2). |
| Q9 | Sizes unknown. Night shifts crossing midnight and members on several teams are supported. |
| A.5 | Departments (`org.departments`) are the teams. The topbar department filter acts as the team filter. |

## Files

| Where | What |
| --- | --- |
| `lib/shifts.ts` | Pure model (server-safe). Types, date/zone math, windows, queries, reporting, edits, payload scoping. Tests: `lib/shifts.test.ts` |
| `features/shifts/{adapters,client,api}.ts` | B6 T6.7: the API is the source. `toShiftState` (team name + id, version), `toOccurrences` (walls derived from the stored INSTANTS in the tenant zone: a night over the DST fold or gap shows its real hours), `makeShiftsClient` (every pattern edit sends `version`; teams by id), loaders (`GET /v1/shifts`, `/v1/shifts/occurrences`). A team-scope manager reads but gets 403 on writes ("All-scope managers only"). The M1A roster overlay is gone (I17). |
| `public/data/shifts/` | Kept ONLY for the demo seed (`api/src/seed/demo/source.ts`); no screen reads it |
| `public/data/shifts/` | `patterns.json`, `assignments.json`, `members.json` (teams + primary manager), `reporting.json` (due minutes, team defaults, overrides) |
| `features/shifts/` | `/shifts` page: week grid, people table, patterns table, pattern/assign dialogs, skeleton. `grid.ts` = helpers shared by view and skeleton |
| `lib/permissions.ts` | Module `shifts` + `shiftScope(role)` → `"all" \| "own" \| "none"` |

People ids are the `p-*` ids of `public/data/tasks/people.json` (`lib/people.ts`), so shifts join with tasks. The staff-rosters `s-*`
records and the settings `u*` users use other ids and are not linked.

## Access

- `shifts` write: owner, admin, manager, ops. They see and edit everyone.
- `shifts` read with a manager home (auditor): sees everyone, read-only.
- `shifts` read with a staff home (supervisor, employee, hr, payroll): own shifts only. The route cuts the bundle with
  `ownShiftState(state, ME_ID)` before it is sent: their assignments, the patterns they use, their own line and override,
  their teams' defaults, and the name of their primary manager. No other person's data is in the payload (smoke-tested).
- Platform role: none.

## Time model (read before using the functions)

- Dates `YYYY-MM-DD`, times `HH:MM`, wall-clock `YYYY-MM-DDTHH:MM`. Everything returned is in the **tenant** zone (`org.timezone`).
- A pattern's start/end are read in `pattern.timeZone` (default: tenant zone) and converted to tenant time.
- A shift belongs to the date it **starts**; `end <= start` means it ends the next day (`end === start` is 24h).
- Lengths, "is it running now" and the due time use real elapsed time (Intl), so DST nights are right
  (London night 22:00–07:00 on 24 Oct 2026 is 600 minutes). Gap times move forward, ambiguous times take the earlier instant.
- Day stepping uses UTC day numbers on strings, like `features/tasks/recurrence.ts`.

## API for step 2 (end-of-shift report)

Server: `loadShifts(api, ...)` from `features/shifts/api.ts`: the API cuts the bundle to the caller (a staff-home caller gets only their own rows); nothing is re-scoped on the client.
Client: every edit is one API write, then the server state replaces the screen.

| Need | Function |
| --- | --- |
| Shifts that start on a day (inbox rows per person and shift) | `shiftsOn(date, patterns, assignments, tz)` → `ShiftOccurrence[]` |
| One person's shifts over a range | `shiftsFor(personId, from, to, patterns, assignments, tz)` |
| Shift running now / last ended shift | `currentShift(personId, now, …)`, `lastEndedShift(personId, now, …, lookbackDays?)` |
| Start/end of an occurrence | `shiftWindow(pattern, date, tz)` → `{ start, end, endsNextDay, minutes, date, patternId, timeZone }` |
| Report id | `shiftKey(personId, window)` → `"p-marcus:pat-sec-night:2026-10-20"` (key reports by it) |
| Does this member report for this shift (FR-M1-21) | `reportsFor(personId, members, reporting, pattern.team)` → `{ on, source, team }`. Pass the **shift's** team for multi-team members |
| Due time (Q7) | `reportDue(window, reporting.dueAfterMinutes)` |
| Status for the inbox (FR-M1-28/30) | `reportTiming(window, dueAfter, now, submittedAt?)` → `upcoming \| in_shift \| open \| missing \| on_time \| late` |
| Prompt at shift end (FR-M1-22) | `reportPromptFor(personId, now, { patterns, assignments, members, reporting }, tz, submittedKeys)` → `{ shift, key, due, timing } \| null` |
| Who to alert | `managerOf(personId, members)`; a manager's team: `directReports(managerId, members)` |
| Tasks in the shift (FR-M1-23) | Filter the member's tasks whose times fall in `[window.start, window.end)` (tenant wall time, compare with `wallToEpoch(…, window.timeZone)`) |

`now` is tenant wall time: `nowInTz(org.today, org.timezone)` from `lib/dates.ts`.

Step 2 suggestions: map `missing` to FR-M1-28 "missing" and `late` to "late"; show the prompt from `reportPromptFor` on the dashboard
and the reports page; keep the report's `shiftKey` so the manager inbox can join reports to `shiftsOn` rows.

## UI

- Week tab (default): rows = people with a reporting line (filtered by the topbar department = team, and search), columns = Mon–Sun.
  Chips show tenant-time hours; night shifts get `+1` (screen readers: "ends Wed 21 Oct"). Week navigation: prev / This week / next.
- People tab: team default switches (Q5), then per person: teams, primary manager, current and upcoming shifts (× to unassign from
  today, history kept via `until`), reporting switch with "Team default" / "Override" and "Use team default", Assign dialog.
- Patterns tab: name, team, hours (+1 for next-day end, nominal length), days, time zone, people on it today; edit and delete.
- Skeleton: ghost text from the same seed (week tab, all teams). Measured equal at 1300 and 390 px.

## Backend notes (B5)

Rulings and follow-ups: `../superpowers/plans/2026-11-17-backend-b5-followups.md`.

- A shift belongs to the date it STARTS on, in the pattern's own zone (F2). Start, end and due times are UTC instants stored in the report when it is first saved (F3).
- A team that has archived patterns cannot be deleted (`team_has_shifts`). Pattern create, edit and archive are all-scope manager only (F14).
- A pattern edit recomputes the virtual rows and alerts of unopened past shifts; saved reports keep their snapshot.
- Today: `POST /v1/today/updates` takes the server's working day as `dayKey` (422 `invalid_day_key` otherwise); the update id carries the actor, and an "evidence still needed" result does not use up the id (H6). Today compares wall-clock strings, so it can be up to an hour off inside the repeated DST hour.
- The sweeps (recurrence, report alerts, export sweep) iterate all tenants. The read-model cache is in-process with a 30 s TTL plus a per-tenant version stamp in Redis (`rm:v:<tenantId>`, B7 S11): any successful write or worker write bumps it, so other instances drop their entries at once; with Redis down they fall back to the 30 s TTL (G2). Sweeps report `sweep_tenants_processed{job}`; shard one when a run exceeds 60 s or 250 tenants (S12).
