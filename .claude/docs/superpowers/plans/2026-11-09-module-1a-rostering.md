# Module 1A Rostering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build location-based rostering as a front-end mock: day-by-day location rosters with individual times, location-scoped supervisors, draft/publish/lock with change requests, rule checks, Repeat roster, staff self-service, and the link into shift reports and cover.

**Architecture:** Pure logic in `lib/rosters.ts`, `lib/roster-access.ts`, `lib/roster-rules.ts`, `lib/roster-repeat.ts`, each with unit tests. UI in `features/rosters/`. JSON seed in `public/data/rosters/`; pages build slim, location-scoped view models on the server. Published roster shifts overlay the existing pattern model inside `getShiftState()`.

**Tech Stack:** Next.js 16 App Router, React 19, shadcn base-nova on base-ui (OpsDesk skin), vitest.

**Spec:** `.claude/docs/superpowers/specs/2026-11-09-module-1a-rostering-design.md` (decisions D1–D13) and `.claude/docs/requirements/SRS.md` §5A.

## Global Constraints

- Read first: `CLAUDE.md`, `.claude/docs/architecture.md`, `.claude/docs/00-design-system/ui-rules.md` (rules 30, 31, 32).
- Features never import each other. Shared pure code in `lib/`, client stores in the feature's `store.ts`.
- Every route gets a `loading.tsx` with an exact skeleton (`SkMask` around the real component where data allows).
- Forms follow rule 32 (`components/form-section.tsx`); a dialog that scrolls at 1568×698 becomes a page (rule 31).
- No hard-coded tenant values. `Ismail` and `Coppers` appear only in seed JSON and tests.
- Never remove, hide or break WhatsApp, Orders & Stock, client files, or the rosters incident/cover model.
- Light and dark, 1568 and 390 widths.
- Dev server: OpsDesk runs on port 3001 (port 3000 is another project, VANTAGE: never touch it). Never start or kill one. Smoke: `SMOKE_BASE=http://localhost:3001 node scripts/smoke.mjs`; new cases in `scripts/smoke/rosters.json`.
- Never run `next build`, never call `localStorage.clear()`. Read the `od-role` cookie before changing it and restore it.
- No commits, no staging. The owner commits; "Verify" replaces each commit step.
- Every task ends with `npx tsc --noEmit`, `npx eslint .`, `npx vitest run`, and smoke with 0 FAIL.

## Review Focus

1. A night shift across the clock change (Sat 24 Oct 2026, 22:00–06:00) is 9 real hours, and rest is counted in real time. Test in Task 6.
2. A supervisor opens another location's URL: "no access", and none of that location's data is in the payload. Test in Task 3.
3. Repeat into a week that already has shifts never duplicates: published target refused, draft target needs replace. Test in Task 8.
4. A person rostered at two locations the same day is flagged even when the supervisor can't see the other site, without revealing it. Test in Task 6.
5. A template in use can't be deleted, and a staff member who has left still shows on past shifts. Test in Task 4.

---

### Task 1: Foundations

D1, D2, D4, D5, D11. FR-RS-31 (scope), FR-RS-32.

**Files:**
- Modify: `lib/types.ts` (`Module` gains `"roster"`; `Role` gains `rosterLevel?`), `lib/permissions.ts` (`PREFIXES` gains `["/rosters", "roster"]`), `public/data/shell/roles.json`, `public/data/settings/roles-matrix.json`, `public/data/shell/navigation.json`, `public/data/billing/entitlements.json`, `features/platform/logic.test.ts` (M8 → M1C), `public/data/tasks/people.json`, `public/data/shifts/members.json`, `public/data/staff-rosters/staff.json` (add `personId` to Daniel Okafor and Grace Mensah only)
- Create: `lib/workforce.ts` + test, `lib/roster-access.ts` + test, `public/data/rosters/{locations,access,workforce}.json`, `public/data/settings/public-holidays.json`, `app/(app)/rosters/page.tsx` + `loading.tsx` (placeholder)

Roles: `access.roster` is `write` for owner, admin, `roster-manager`, `location-supervisor`; `none` for platform; `read` for the rest. `rosterLevel: "office"` on owner, admin, `roster-manager`; `"supervisor"` on `location-supervisor`. New role `location-supervisor` signs in as `p-ismail`, new role `roster-manager` as `p-priya`. Add `p-ismail` (Security) to people and members. Holidays, keyed `IE`, 2026: 01-01, 02-02, 03-17, 04-06, 05-04, 06-01, 08-03, 10-26, 12-25, 12-26. Nav: "Location Rosters", `/rosters`, icon `roster`, before Staff & Rosters. Entitlements: `M1A` in business and enterprise; `modules.roster = "M1A"`; rename `M8` to `M1C` everywhere it is an id (grep first).

**Interfaces (Produces):**
```ts
// lib/workforce.ts
export type WorkforceMember = { id: string; name: string; role: string; dept: string; homeLocationId: string | null; qualifications: { type: string; expires: string | null }[]; leftOn: string | null }
export function mergeWorkforce(people: Person[], staff: StaffRow[], extras: WorkforceExtra[]): WorkforceMember[]
export async function getWorkforce(): Promise<WorkforceMember[]>
// lib/roster-access.ts
export type LocationGrant = { locationId: string; personId: string }
export type OfficeLimit = { personId: string; except: string[] }
export type RosterAccess = { scope: "all" | "locations" | "own" | "none"; locationIds: string[] | null; editDraft: boolean; editPublished: boolean; approve: boolean }
export function rosterAccess(role: Role, personId: string, grants: LocationGrant[], limits: OfficeLimit[], allLocationIds: string[]): RosterAccess
export function canSeeLocation(a: RosterAccess, locationId: string): boolean
```

- [ ] **Step 1: Tests.** `workforce.test.ts`: a staff row with `personId` merges into one member with the `p-*` id; a row without keeps `s-*`; no duplicate ids. `roster-access.test.ts`:
  - `office` role: `scope "all"`, `editPublished true`, `approve true`.
  - Roster manager with `except: ["loc-a"]`: `locationIds` excludes it, `canSeeLocation(a,"loc-a")` false.
  - `supervisor` with one grant: `scope "locations"`, `editDraft true`, `editPublished false`, `approve false`.
  - Supervisor with no grants: `locationIds []`.
  - Manager-home read role: `scope "all"`, all edit flags false.
  - Staff-home role: `scope "own"`. Platform: `scope "none"`.
- [ ] **Step 2:** `npx vitest run lib/workforce.test.ts lib/roster-access.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3:** Implement, add seed and the placeholder page gated by `rosterAccess` (`AccessRestricted` on `none`).
- [ ] **Step 4:** Tests PASS. Smoke cases: `/rosters` renders for `owner` and `location-supervisor`; `platform` gets restricted; Starter tenant gets the "Not in your plan" variant.
- [ ] **Step 5: Verify** (Global Constraints).

### Task 2: Roster model and seed

**Files:** Create `lib/rosters.ts` + test (holds the model types below), `public/data/rosters/{templates,targets,weeks,shifts,history}.json`, `features/rosters/{types.ts,api.ts,store.ts,index.ts}`.

Seed a published and a draft Coppers week (`2026-10-19`, `2026-10-26`) and at least two other locations. The `2026-10-19` week uses only `s-*` people, so existing shift-report seeds stay valid. Include two people on the same Coppers shift with different start times.

**Interfaces (Produces):**
```ts
export type Location = { id: string; name: string; address: string; pin: { lat: number; lng: number }; zoneRadiusM: number; openingHours: string; contact: string; swapApprovalDelegated: boolean }
export type ShiftTemplate = { id: string; locationId: string; name: string; start: string; end: string; unpaidBreakMin: number; role: string; requires: string[] }
export type StaffingTarget = { locationId: string; templateId: string; weekday: Weekday; count: number }
export type RosterWeek = { id: string; locationId: string; weekStart: string; status: "draft" | "published"; publishedAt: string | null; publishedBy: string | null; autoRepeatDays: number | null }
export type RosterShift = { id: string; weekId: string; locationId: string; date: string; personId: string | null; templateId: string; role: string; start: string; end: string; unpaidBreakMin: number; confirmedAt: string | null }
export type DayColumn = { date: string; shifts: RosterShift[]; count: number; target: number; short: number; over: number }
export function dayColumns(week: RosterWeek, shifts: RosterShift[], targets: StaffingTarget[], templates: ShiftTemplate[]): DayColumn[]
export function shiftMinutes(s: Pick<RosterShift, "date" | "start" | "end" | "unpaidBreakMin">, tz: string): number
export function shiftEnd(s: Pick<RosterShift, "date" | "start" | "end">, tz: string): string
export function rosterRange(view: "day" | "week" | "fortnight" | "month", anchor: string): { from: string; to: string }
// features/rosters/types.ts
export type RosterData = { locations: Location[]; templates: ShiftTemplate[]; targets: StaffingTarget[]; weeks: RosterWeek[]; shifts: RosterShift[]; members: WorkforceMember[] }
// features/rosters/api.ts
export async function getRosterData(access: RosterAccess, personId: string): Promise<RosterData> // only permitted locations; "own" gets own shifts
```

- [ ] **Step 1: Tests.** `dayColumns` returns seven days; open shifts (`personId null`) don't count; `short`/`over` against target. A 22:00–06:00 shift stays on its start date (FR-RS-21). `shiftMinutes` subtracts the unpaid break. `rosterRange("fortnight", ...)` is 14 days from Monday.
- [ ] **Step 2:** Run, expect FAIL. **Step 3:** Implement with `lib/shifts.ts` time helpers. **Step 4:** PASS.
- [ ] **Step 5: Verify.**

### Task 3: Roster views

FR-RS-10, 11, 12, 33. AC-RS-01, AC-RS-03. Review Focus 2.

**Files:** Create `features/rosters/components/{rosters-view,day-board,person-grid,skeletons}.tsx`, `features/rosters/view.ts` + test, `app/styles/rosters.css`; modify `app/(app)/rosters/page.tsx`, `loading.tsx`.

`/rosters?location=&week=&view=`. Location select, range seg (Day, Week, Fortnight, Month), group seg (By location, By person, By role). Day board: one column per day, a card per day at ≤640px. Each person shows name, own times, role; the day shows count/target with the shortfall highlighted. Draft or Published pill. All-locations option for `scope "all"`.

**Interfaces (Produces):** `export function rosterViewData(data: RosterData, access: RosterAccess, q: { location?: string; week?: string; view?: string; group?: string }, today: string): RosterViewData | { denied: true }`.

- [ ] **Step 1: Tests** (`view.test.ts`): a supervisor asking for an ungranted location gets `{ denied: true }`; `JSON.stringify` of a supervisor's view data contains no other location's name, shift id or person.
- [ ] **Step 2:** FAIL. **Step 3:** Implement, exact skeleton. **Step 4:** PASS. Smoke: Coppers week shows 7 day columns and a count; `location-supervisor` asking for another location gets "no access" and `notExpect` that location's name; `roster-manager` sees every location.
- [ ] **Step 5: Verify.**

### Task 4: Locations admin and supervisor grants

FR-RS-01, 02, 03, 04, 30, 32, 34. Review Focus 5.

**Files:** Create `app/(app)/rosters/locations/page.tsx` + `loading.tsx`, `app/(app)/rosters/locations/[id]/page.tsx` + `loading.tsx`, `features/rosters/components/{locations-view,location-form}.tsx`, `features/rosters/admin.ts` + test.

Gated to `editPublished` roles. Form page with FormSections: Details, Clock-in zone, Shift templates, Staffing targets, Required skills, Supervisors (`PeoplePicker`), Swap approval.

**Interfaces (Produces):** `canDeleteTemplate(id: string, shifts: RosterShift[]): boolean`; `setSupervisors(grants: LocationGrant[], locationId: string, people: string[]): { grants: LocationGrant[]; added: string[]; removed: string[] }`; `validateLocation(f: LocationForm): Errors`.

- [ ] **Step 1: Tests.** A template used by any shift can't be deleted. `setSupervisors` reports added and removed. Radius must be above 0. A member with `leftOn` still resolves by id on past shifts, and isn't offered for new ones.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; each supervisor change writes a roster history/audit line (FR-RS-34). **Step 4:** PASS, smoke (restricted for `location-supervisor`).
- [ ] **Step 5: Verify.**

### Task 5: Editing shifts

FR-RS-20, 21, 22 (assign several), 04 (suggestions). AC-RS-02.

**Files:** Create `features/rosters/components/shift-dialog.tsx`, `features/rosters/editing.ts` + test; modify `day-board.tsx`.

Add or edit by form: template (fills times), people (`PeoplePicker`, one shift each), individual start and end, break. Drag a card between days, using the native drag pattern in `features/tasks/components/task-board.tsx`. Only people holding a template's `requires` are suggested. Controls show only when `canEditShift`.

**Interfaces (Produces):**
```ts
export function canEditShift(a: RosterAccess, week: RosterWeek): boolean
export function addShifts(input: ShiftInput, people: string[], ids: string[]): RosterShift[]
export function moveShift(s: RosterShift, date: string): RosterShift
export function eligible(members: WorkforceMember[], t: ShiftTemplate, date: string): WorkforceMember[]
```

- [ ] **Step 1: Tests.** Two people on one template keep different starts (AC-RS-02). `canEditShift` is true for a supervisor on a draft, false on a published week, true for an office role on both. `eligible` drops an expired licence and a left member.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. Browser check: add, edit, drag.
- [ ] **Step 5: Verify.**

### Task 6: Rule checks

FR-RS-44. Review Focus 1, 4.

**Files:** Create `lib/roster-rules.ts` + test, `public/data/rosters/rules.json`, `public/data/rosters/{leave,availability}.json`.

**Interfaces (Produces):**
```ts
export type RuleId = "double_booking" | "approved_leave" | "unavailable" | "daily_rest" | "weekly_rest" | "avg_48h" | "expired_licence" | "left"
export type RuleViolation = { rule: RuleId; shiftId: string; personId: string; severity: "block" | "warn"; message: string; otherShiftIds: string[] }
export type LeaveRequest = { id: string; personId: string; from: string; to: string; kind: string; status: "requested" | "approved" | "rejected"; decidedBy: string | null; decidedAt: string | null }
export type Availability = { personId: string; weekday: Weekday; from: string; to: string } // the person is NOT available in this window
export type RuleContext = { shifts: RosterShift[]; members: WorkforceMember[]; leave: LeaveRequest[]; availability: Availability[]; templates: ShiftTemplate[]; severity: Record<RuleId, "block" | "warn">; avgWeekReferenceWeeks: number; tz: string; visibleLocationIds: string[] | null }
export function checkShifts(target: RosterShift[], ctx: RuleContext): RuleViolation[]
export function blocking(v: RuleViolation[]): RuleViolation[]
```
`rules.json`: `avgWeekReferenceWeeks: 17`; all rules `warn` except `double_booking` and `approved_leave`, which are `block`.

- [ ] **Step 1: Tests.**
  - `daily_rest`: 10h between shifts fails, 11h passes; the message names the person and both shifts (AC-RS-04).
  - Review Focus 1: Sat `2026-10-24` 22:00–06:00 is 540 minutes; rest after it is real time.
  - `weekly_rest`: seven shifts with no 24h gap fails.
  - `avg_48h`: over the reference period fails at above 48, passes at exactly 48.
  - `double_booking` on overlap, across midnight too.
  - Review Focus 4: with `visibleLocationIds: ["a"]`, a clash at `b` gives "Already rostered elsewhere", and the message has no site or time of `b`.
  - `approved_leave`, `unavailable`, `expired_licence` on the shift date; a licence expiring that day still passes.
- [ ] **Step 2:** FAIL. **Step 3:** Implement with epochs from `wallToEpoch`. **Step 4:** PASS.
- [ ] **Step 5: Verify.**

### Task 7: Publish, lock, change requests

FR-RS-23, 24, 31, 35, 36, 37. AC-RS-04, AC-RS-05.

**Files:** Create `features/rosters/publishing.ts` + test, `features/rosters/components/{publish-dialog,change-request-dialog,reason-dialog,history-panel,requests-panel}.tsx`; modify `rosters-view.tsx`, `store.ts`.

Publish shows violations; a `block` needs a role allowed to override and a reason. A supervisor on a published week sees no edit controls, only "Request change". Office edits need a reason. Staff affected must re-confirm.

**Interfaces (Produces):**
```ts
export type HistoryEntry = { id: string; weekId: string; shiftId: string | null; at: string; by: string; action: string; before: unknown; after: unknown; reason: string | null }
export type ChangeRequest = { id: string; weekId: string; shiftId: string; by: string; at: string; patch: Partial<RosterShift>; why: string; status: "open" | "approved" | "rejected"; decidedBy: string | null; decidedAt: string | null; note: string | null }
export function publishWeek(week: RosterWeek, a: RosterAccess, violations: RuleViolation[], overrideReason: string | null, by: string, at: string): { week: RosterWeek; entry: HistoryEntry }
export function editPublished(s: RosterShift, patch: Partial<RosterShift>, a: RosterAccess, reason: string, by: string, at: string): { shift: RosterShift; entry: HistoryEntry }
export function requestChange(s: RosterShift, patch: Partial<RosterShift>, why: string, by: string, at: string, ids: string[]): ChangeRequest
export function decideRequest(r: ChangeRequest, s: RosterShift, a: RosterAccess, approve: boolean, note: string | null, by: string, at: string): { request: ChangeRequest; shift: RosterShift; entry: HistoryEntry | null }
```

- [ ] **Step 1: Tests.** `publishWeek` throws on blocking violations with no reason. `editPublished` throws for a supervisor (AC-RS-05), throws on an empty reason, records before and after, and clears `confirmedAt`. An approved request applies the patch and clears `confirmedAt`; a rejected one leaves the shift unchanged. `decideRequest` throws for a supervisor.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS. Browser: as `location-supervisor`, a published week has no edit controls.
- [ ] **Step 5: Verify.**

### Task 8: Repeat roster and templates

FR-RS-22 (copy last week), 26, 27, 28, 29. AC-RS-06. Review Focus 3.

**Files:** Create `lib/roster-repeat.ts` + test, `features/rosters/components/{repeat-dialog,conflicts-panel,templates-panel}.tsx`, `public/data/rosters/week-templates.json`.

**Interfaces (Produces):**
```ts
export type RepeatConflict = { shiftId: string; personId: string; reason: RuleId | "public_holiday"; open: boolean; message: string }
export type RepeatResult = { week: RosterWeek; shifts: RosterShift[]; conflicts: RepeatConflict[] }
export function repeatWeek(source: RosterWeek, shifts: RosterShift[], targetWeekStart: string, existing: RosterWeek | null, replace: boolean, ctx: RuleContext, holidays: string[], ids: string[]): RepeatResult
export function autoRepeatDue(weeks: RosterWeek[], today: string): RosterWeek[]
export function saveWeekTemplate(name: string, week: RosterWeek, shifts: RosterShift[], id: string): WeekTemplate
export function applyWeekTemplate(t: WeekTemplate, locationId: string, weekStart: string, ctx: RuleContext, holidays: string[], ids: string[]): RepeatResult
```

- [ ] **Step 1: Tests.**
  - Same people and start times, dates +7, status `draft`, `confirmedAt null` (AC-RS-06).
  - Approved leave: `personId null`, one conflict with `open: true`, shift count unchanged (never dropped).
  - Public holiday: person stays, conflict with `open: false`.
  - Review Focus 3: published target throws; draft target without `replace` throws; with `replace` the old shifts are gone and there are no duplicates.
  - Repeat over N weeks creates N drafts.
  - `autoRepeatDue` is true when the next week is within `autoRepeatDays` and has no draft.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. The check for a repeated week includes the shifts already created. **Step 4:** PASS. Browser: Repeat, conflict list, publish.
- [ ] **Step 5: Verify.**

### Task 9: Staff self-service

FR-RS-23 (confirm), 33, 40, 41.

**Files:** Create `app/(app)/rosters/mine/page.tsx` + `loading.tsx`, `features/rosters/components/{my-roster,leave-form,availability-form,leave-panel}.tsx`, `features/rosters/self-service.ts` + test, `lib/ics.ts` + test.

One combined roster across locations, "Seen" confirm, add to calendar (`.ics` download), availability, leave request. Leave approval follows D8.

**Interfaces (Produces):** `toIcs(shifts: IcsShift[], tz: string): string`; `canApproveLeave(a: RosterAccess, m: WorkforceMember): boolean`; `decideLeave(r: LeaveRequest, approve: boolean, by: string, at: string): LeaveRequest`; `combinedRoster(personId: string, shifts: RosterShift[], weeks: RosterWeek[]): RosterShift[]` (published only).

- [ ] **Step 1: Tests.** `combinedRoster` joins two locations and hides drafts. `toIcs` has one `VEVENT` per shift, and an overnight shift ends the next day. `canApproveLeave`: supervisor of the home location true, of another location false, office true.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS, smoke for `employee`.
- [ ] **Step 5: Verify.**

### Task 10: Open shifts and swaps

FR-RS-38, 42, 43.

**Files:** Create `features/rosters/exchange.ts` + test, `features/rosters/components/{open-shifts-panel,swap-dialog}.tsx`.

**Interfaces (Produces):** `approverFor(week: RosterWeek, location: Location, a: RosterAccess): boolean` (D6); `claimShift(s: RosterShift, m: WorkforceMember, t: ShiftTemplate, date: string): Claim`; `approveClaim(c: Claim, s: RosterShift, a: RosterAccess, week: RosterWeek, location: Location, ctx: RuleContext, by: string, at: string): { shift: RosterShift; violations: RuleViolation[] }`; `requestSwap(...)`, `approveSwap(...)` with the same checks.

- [ ] **Step 1: Tests.** `approverFor`: supervisor on a draft true; on a published week false; on a published week with `swapApprovalDelegated` true; office always true. An unqualified member can't claim. A swap that breaks a blocking rule is refused.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Verify.**

### Task 11: Connect to shift reports and cover

FR-RS-25, 39. D3, D12.

**Files:** Create `lib/roster-overlay.ts` + test; modify `lib/shifts-data.ts`, `features/staff-rosters/api.ts`, `features/staff-rosters/types.ts`, `gaps-list.tsx`, `day-board.tsx`.

**Interfaces (Produces):** `overlayRoster(state: ShiftState, weeks: RosterWeek[], shifts: RosterShift[], templates: ShiftTemplate[], locations: Location[]): ShiftState`; `gapsFromOpenShifts(shifts, weeks, templates, locations): RosterGap[]` (`rosterShiftId` set; published weeks only).

- [ ] **Step 1: Tests.** A published shift becomes a one-day pattern and assignment; `shiftsOn` returns its individual times. Drafts and open shifts are ignored. A person rostered in a published week has no pattern occurrence that week, and keeps it the week before and after. `shiftKey` is unique for two shifts on one day. A report still resolves through `occurrenceOf`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement; apply the overlay inside `getShiftState()`, which stays argument-free: it calls `getSession()` and overlays only when `hasProductModule(session.entitlements, "M1A")`. The overlay data is read from `public/data/rosters/`, so `lib/` never imports the feature: move the Task 2 model types to `lib/rosters.ts` and re-export them from `features/rosters/types.ts`. **Step 4:** PASS. Smoke: existing shift-report ids still render; a location supervisor can still log an incident on a published week (FR-RS-39).
- [ ] **Step 5: Verify.**

### Task 12: Docs and final pass

**Files:** Create `.claude/docs/features/rosters.md`; modify `.claude/docs/README.md`, `.claude/docs/architecture.md` (rule 3 list), `.claude/docs/requirements/SRS.md` (Appendix A only).

- [ ] **Step 1:** Write the doc: routes, access table, model, overlay, mock limits, deferred items.
- [ ] **Step 2:** Scan every new route at 1568, 768, 390 for overlaps and horizontal overflow, and every dialog for scrolling at 1568×698. Fix what is found.
- [ ] **Step 3: Verify.**

## Requirement coverage

| Tasks | Requirements |
|---|---|
| 1 | FR-RS-31 (scope), 32 |
| 3 | FR-RS-10, 11, 12, 33; AC-RS-01, 03 |
| 4 | FR-RS-01, 02, 03, 04, 30, 32, 34 |
| 5 | FR-RS-04, 20, 21, 22; AC-RS-02 |
| 6 | FR-RS-44; AC-RS-04 |
| 7 | FR-RS-23, 24, 31, 35, 36, 37; AC-RS-04, 05 |
| 8 | FR-RS-22, 26, 27, 28, 29; AC-RS-06 |
| 9 | FR-RS-23, 33, 40, 41 |
| 10 | FR-RS-38, 42, 43 |
| 11 | FR-RS-25, 39 |
| Deferred (design, Non-goals) | FR-RS-13, 14, 22 (rotating pattern), 45 |
