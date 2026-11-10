# Location Rosters (`/rosters`): Module 1A

SRS v1.3 §5A (`FR-RS-*`, `AC-RS-*`, `CR-07..09`). Design and decisions D1..D13: `superpowers/specs/2026-11-09-module-1a-rostering-design.md`.
Gated by entitlement `M1A` (Business, Enterprise) and the `roster` module permission. Front-end mock like the rest of the app.

## Routes

| Route | What |
| --- | --- |
| `/rosters` | Location week view: day board, person grid, staffing target per day, publish, repeat, templates, open shifts, swaps, change requests, history, leave queue. `?location=&week=` deep-links |
| `/rosters/locations` | Location list (office roles only) |
| `/rosters/locations/[id]` | Location form: address, pin, radius, hours, contact, supervisors, `swapApprovalDelegated`, shift types, staffing targets |
| `/rosters/mine` | Staff self-service: own roster, confirm, `.ics` export, availability, leave |

Nav: "Location Rosters" (D1, name kept apart from "Shifts" and "Staff & Rosters") and "My roster". Skeletons in `features/rosters/components/skeletons.tsx`; `RostersSkeleton` and `MyRosterSkeleton` mask the real view.

## Files

| Where | What |
| --- | --- |
| `lib/rosters.ts` | Pure model: Location, ShiftTemplate, StaffingTarget, RosterWeek, RosterShift, HistoryEntry, `dayColumns`, `shiftEnd/shiftMinutes`, `rosterRange` |
| `lib/roster-access.ts` | `rosterAccess(role, personId, grants, limits, locationIds)`, `canSeeLocation` |
| `lib/roster-rules.ts` | Rule checks (pure) |
| `lib/roster-repeat.ts` | `repeatWeek`, `saveWeekTemplate`, `applyWeekTemplate`, `autoRepeatDue` |
| `lib/roster-overlay.ts` | `overlayRoster`: published roster shifts into the shift state |
| `lib/workforce.ts` | `getWorkforce()`: one person list (D2) |
| `lib/ics.ts` | `toIcs` (UTC times, CRLF, 75-octet folding) |
| `features/rosters/` | `view.ts` (payload cut + `rosterEdit`), `editing.ts`, `publishing.ts`, `repeating.ts`, `exchange.ts`, `self-service.ts`, `admin.ts`, `api.ts`, `scope.ts` (store scope keys and merges, one place), `store.ts` (client stores), `components/` |
| `app/(app)/rosters/actions.ts` | Server actions `checkWeekRules`, `checkAssignRules` |
| `public/data/rosters/` | `locations`, `access` (grants, office `limits.except`), `templates` (shift types), `targets`, `weeks`, `shifts`, `history`, `requests` (change requests), `claims`, `swaps`, `leave`, `availability`, `rules`, `week-templates`, `workforce` (extras: home location, qualifications, `leftOn`); `settings/public-holidays.json` |

## Access (D4, D5)

`Role.rosterLevel` = `office` or `supervisor`; `rosterAccess()` returns `{scope, locationIds, editDraft, editPublished, approve}`.

| Who | Sees | Draft week | Published week |
| --- | --- | --- | --- |
| owner, admin, Roster Manager (`office`) | all locations; a Roster Manager loses `except` locations (`access.json` `limits`) | edit | edit with a reason, approve |
| Location Supervisor (`supervisor`) | granted locations only (`grants`) | edit, approve claims and swaps | read, change request (D7: no unpublish) |
| other manager-home roles with `roster: read` | all | read | read |
| staff-home roles | own shifts only (`/rosters/mine`) | none | confirm, claim, swap |

Platform role and tenants without M1A: not-in-plan or restricted page. Location Supervisor is its own person (`p-ismail`).
Location Supervisor has read on `tasks` and write on `roster` only: `staff`, `shifts`, `dashboard` and `whatsapp` are `none` (ruling, final review finding 4), because those legacy modules are not location-aware and would show other sites' gaps, incidents, people and shifts. Nav hides them; `/staff-rosters` and `/shifts` show "Access restricted" (smoke covers both). Restoring a module for this role needs location scoping first.

## Rule checks (D9)

`RuleId`: `double_booking`, `approved_leave`, `unavailable`, `daily_rest`, `weekly_rest`, `avg_48h`, `expired_licence`, `left`.
Severity per rule in `rosters/rules.json`: block for `double_booking` and `approved_leave`, warn for the rest. `avgWeekReferenceWeeks` = 17 (about the Act's 4 months), data not code.
Rest (11h daily, 24h weekly) and hours use real elapsed time, so DST nights are right. `weekly_rest` reports once per person per overlapping window (first shift carries it). `unavailable` is a "not available" window per weekday, overnight windows are split at midnight.

## Publish, lock, change request, history (FR-RS-30..37, 44)

- `publishWeek`: warnings never stop it. A blocking violation needs an office role and a reason. A supervisor can't publish over a block.
- Published weeks lock for supervisors. Office `editPublished` needs a reason and clears the person's confirmation.
- Change patches are whitelisted (`date`, `start`, `end`, `unpaidBreakMin`, `personId`, `templateId`, `role`; the office edit may also carry `weekId` for a move). A request cannot move a shift to another week. When the person, template or day changes, the person must be eligible (always refused otherwise); a change that adds a blocking violation throws `BlockedError` unless an office role gives a reason (the edit's own reason, or "Approve anyway" on a request). Checked in this browser's shifts only (see mock limits).
- Remove a shift: `removeShift`. Draft week: any role that may edit it. Published week: office only, with a reason. History keeps the whole shift as `before`.
- `addShiftsChecked`, `moveShiftChecked` and `removeShift` are the access and lock guards the view calls; `moveShiftChecked` is for draft weeks (published moves go through `editPublished`).
- Supervisor on a published week: `requestChange` (reason) -> office `decideRequest` approve or reject (requests panel).
- Every change writes a `HistoryEntry` (`weekId` null for location-level changes such as supervisor grants), shown in the history panel.

## Repeat and templates (FR-RS-22, 26..29; D10)

- Repeat copies a week to the next one, or N weeks (all or nothing, `repeatManyChecked`). Refuses a published target; a draft target needs an explicit replace; target must be a Monday.
- Each copy is re-checked. Ruling: only block-severity violations turn a copied shift into an open shift plus a conflict line. A warn violation keeps the person and lists a conflict with `open: false`. A public holiday is an information line only (the person stays), shown only when the shift has no violation.
- Week templates (`week-templates.json`) save a week and apply it to a week with no roster. Applied at another location, a person from elsewhere becomes open and the shift takes that site's matching shift type (`templateId: ""` when none).
- `autoRepeatDays` on a week: `autoRepeatDue` finds weeks due for the next copy.
- Shift types (`templates.json`) cannot be deleted while a shift uses them (`canDeleteTemplate`).

## Open shifts and swaps (FR-RS-38, 42, 43; D6)

- A member claims an open shift on a published, upcoming week if eligible (`ineligible`: left, or required licence missing or expired). A swap is a hand-over request to a named colleague.
- `approverFor(week, location, access)`: office roles always (within their locations). A supervisor on a draft week, and on a published week only if `location.swapApprovalDelegated`. Staff and read-only never. Nobody approves their own.
- Approval re-runs the rules (`checkAssignRules`). A block stops it unless an office role gives a reason (`BlockedError`).

## Staff self-service (FR-RS-40, 41; D8)

- Confirm each shift (`confirmedAt`), "Seen" state, `.ics` export of own roster, weekly availability (not-available windows), leave request.
- Leave is approved by a supervisor of the person's `homeLocationId`, else an office role for people homed at a location the role sees or nowhere (`canApproveLeave`; a Roster Manager with an `except` never decides for someone homed at the excepted site). Nobody decides their own leave. Approved leave blocks rostering (`approved_leave`).
- Roster shifts and pattern shifts show together on `/rosters/mine` (`combinedRoster`).

## Overlay into shift reports (D3, FR-RS-25)

`overlayRoster` turns each published roster shift into a one-day pattern (id = roster shift id, name `<type> · <location>`) plus a one-day assignment, and carves the person's pattern assignment out of that week. So shift reports, Today and deadlines work unchanged.

- `getShiftState()` (`lib/shifts-data.ts`) overlays, only when the tenant has M1A. Used by reports, Today, deadlines and the Shifts "own" view.
- `getBaseShiftState()` has no overlay. The Shifts admin page uses it so it lists only real patterns (it therefore does not show roster shifts).
- `s-*` staff have no shift-member row, so no report prompt for them.

## Derived gaps (D12)

`gapsFromOpenShifts` (`features/staff-rosters/logic.ts`) makes every upcoming open shift a gap in Staff & Rosters (`GAP-RS-<shiftId>`), labelled "From roster", linking back to `/rosters?location=&week=`. Cut by roster access (a supervisor sees only their sites). Recording cover there does not assign the roster shift in this mock.

## Privacy

A caller who does not see every location (a supervisor, or an office role with an `except`) never receives another location's shifts, history, requests, templates or leave, nor its people by home: `getRosterData`, `getLocationAdminData`, `getRosterExchange` and `getLeaveQueue` cut the workforce with `cutMembers`/`scopedMembers` (on a visible shift, a visible home for office roles, or a licence a visible shift type requires; licences cut to those types; a hidden home is dropped, and a supervisor gets no home at all). `view.ts` cuts the view by `rosterAccess` on the server. A clash at a site the caller can't see reads "Already rostered elsewhere" with no site or time.
Server actions (`actions.ts`) take the caller from the session and run the rules over all locations:
- `checkWeekRules(weekId, shifts)`: the caller also posts their own shifts of that week (made in this session, so a new week or shift is checked). `sanitizePosted` keeps only shifts at locations the session may see, of people in the workforce, dated inside the week (a new week: one Monday), then they replace the same-id seed shifts and the seed shifts of that week at the caller's locations. The check runs against everything else and returns violations on those shifts only, generic message for hidden causes. An unknown week answers for the posted shifts.
- `checkAssignRules(pairs)`: for claims and swaps; restricted to visible-location shifts and people tied to that location.
- `getRosterRules` is cut per caller (leave and availability of people on a visible shift only; leave is approved-only with kind and decision blanked).
No hour total reaches a caller who does not see every location: the `avg_48h` text reads "is over the 48-hour weekly average" (week check) or "would go over ..." (claims and swaps), because the total includes hidden-site hours. The browser's own check of its visible shifts may still show a number (visible hours only).
Accepted leak, as a ruling: names of other-site staff holding a licence an in-scope shift type requires (name and that licence only, no home site).

## Mock limits (D13)

- Edits live in client stores until reload; a roster published in a session does not reach server-built shift reports. "The API refuses" (AC-RS-05) shows as disabled controls plus pure guards.
- Staff claims and swap requests made in the session are not on the server, so `checkAssignRules` cannot see them.
- `checkWeekRules` reads mock JSON for the other sites; the caller's own edits come in as posted shifts. A shift moved out of the week being published is not seen in its new week by this call.
- Change checks on published shifts (`editPublished`, `decideRequest`) run over this browser's shifts only, not the server's hidden-site shifts.
- Stores shared between pages use one key (`scope.ts`): `rosterScopeKey` for Rosters, Locations and the exchange (claims, swaps are one list on `/rosters` and `/rosters/mine`, topped up by `mergeById`, so an approved claim never reappears as open); `mineScopeKey` for the My roster only stores. The location form seeds `historyStore` with the same history as Rosters (`LocationAdminData.history`). Rosters reads `locationsStore` (`mergeLocations`), so a location added or renamed in the form shows at once.
- `confirmStore` is not synced with the shift store's `confirmedAt` clear in-session.

## Deferred / open decisions

Not built: FR-RS-13 (PDF/Excel export), FR-RS-14 (labour cost), FR-RS-22 rotating pattern, FR-RS-45 (Module 2). Module 1B and 1C untouched.

**FR-RS-39 (decision 4 in SRS A.8):** read as Module 1B attendance work (no-shows, lateness, clock corrections), which the roster lock does not block. Nothing in Module 1A blocks it. `location-supervisor` has no access to `staff`, so it cannot log incidents in Staff & Rosters; that is not what FR-RS-39 asks. A narrow attendance right for the supervisor's own locations comes with Module 1B.

**Checks still owed:** Chrome and visual checks (1568, 768, 390; every dialog at 1568x698); several screens were never seen in a browser. Dialog fit (rule 31), "From roster" label wrap at 390.

**Minor items kept from review:**
- Rules: `avg_48h` divides by the full window (understates new starters) and dedupe violations by rule+shift+person; seed rule breaks (p-leo overlap, s-silva 1h rest) are deliberate demo warnings.
- Editing: add dialog can't create an open shift with zero people; drag-over flicker; Firefox `draggable li + button`; person/role groupings are read-only; `rosterEdit` sends RosterData twice; `scopedMembers` keeps role/dept of out-of-scope licence holders.
- Payload and access: the locations form lists only the cut workforce as supervisor candidates for a Roster Manager with an `except`; stores on `/rosters/mine` are not scope-checked on role switch without reload; claimant race returns `[]` if the tie to the location is gone; staff-created claims not on the server; `validateLocation` accepts a huge radius; supervisor history uses `Date.now`.
- Repeat and holidays: a warn conflict suppresses the holiday line for that shift; template apply to an existing draft is not offered; a supervisor's repeat can't see other sites (the publish check does, through `checkWeekRules` with the posted shifts).
- Self-service: UID in `.ics` is not tenant-unique; overnight availability halves are removed independently; no smoke for a supervisor's `/rosters/mine` leak.
- Overlay and gaps: `getShiftState` reads 4 extra files per call; derived gap `when` is `next_week` for any date more than a day away; missing tests for an assignment starting or ending inside a carved week and one person at two locations.
- Cleanup: `lib/entitlements.test.ts` still uses id `M8` in fixtures; `shiftEnd` has an unused `_tz`; `/rosters` page has two redundant `AccessRestricted` branches; `view.ts` scope-"own" and empty `?location=` defaults; ISO regex accepts impossible dates; `[id]/loading.tsx` shows the first location's form; `scripts/smoke/rosters.json` formatting.
