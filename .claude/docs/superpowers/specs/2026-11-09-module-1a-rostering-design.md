# Module 1A Rostering by location: design

Date: 9 Nov 2026. Requirements: SRS v1.3 §5A (`FR-RS-*`, `AC-RS-*`, `CR-07..09`). The owner asked for a plan without questions, so every decision below is Claude's and can be overruled.

## Why

The first client needs to see, location by location and day by day, who works and at what time, and to give a site lead rights over one site only. The app can't do this today: shifts are computed from repeating patterns, people have no single id, and permissions stop at module level.

## Goals

1. A location's week shows each day, each person with their own times, and the count against target (CR-07, CR-08).
2. A supervisor sees and edits only their locations (CR-09), and published weeks are locked for them.
3. Repeat roster makes next week a one-click job, with conflicts listed and never dropped.
4. Published roster shifts drive the existing shift reports, Today card and deadlines.

## Non-goals

- Module 1B (clocking, timesheets) and 1C (payroll).
- Real server enforcement, push notifications and the Android app. This stays a front-end mock like the rest of the app, built so a backend can take over the same types.
- Go-live. SRS §3 starts Phase 1B after the Phase 1 gate; this build is for demo and client feedback.
- For now: FR-RS-13 (PDF/Excel export), FR-RS-14 (labour cost), the rotating-pattern part of FR-RS-22, FR-RS-45 (Module 2).

## Anti-goals

- Breaking or hiding the incident/cover model, WhatsApp, Orders & Stock or client files (owner decision, 28 Oct 2026).
- `Ismail` or `Coppers` anywhere but seed data.
- Another location's data in a supervisor's page payload.

## Decisions

**D1. Navigation.** New menu item "Location Rosters" at `/rosters`. "Shifts" and "Staff & Rosters" keep their names. A distinct label avoids renaming a page the owner said to keep.

**D2. One person id.** The directory (`tasks/people.json`, `p-*`) stays canonical. A new `getWorkforce()` merges it with `staff-rosters/staff.json`: a staff row with `personId` is that directory person; the rest keep their `s-*` id. `payroll/directory.json` waits for Module 1C.

**D3. Patterns stay; roster shifts overlay them.** `RosterShift` is a dated record with its own start and end. Each published roster shift is turned into a one-day pattern plus a one-day assignment, and `getShiftState()` returns the merged state. Every consumer (shift reports, Today, deadlines, notifications) keeps working unchanged. The pattern id is the roster shift id, so report ids stay unique. People rostered in a published week have their pattern assignment carved out for that week.

**D4. Location access is data.** `Role` gains `rosterLevel?: "office" | "supervisor"`. A pure `rosterAccess()` returns the scope, and servers cut payloads by it.

| Who | Scope | Published weeks |
|---|---|---|
| `office` roles (owner, admin, new Roster Manager) | all locations, minus `except` for Roster Managers | edit, with reason |
| `supervisor` role (new Location Supervisor) | granted locations | read, change request |
| other manager-home roles with read | all, read only | read |
| staff-home roles | own shifts | read, confirm |

**D5. "Office roster manager" is a new role.** The SRS uses the term but §2.2 doesn't define it.

**D6. Open shifts and swaps.** On a draft week the supervisor approves; on a published week a higher-level user approves, unless the location has `swapApprovalDelegated`. This resolves FR-RS-42/43 against FR-RS-38.

**D7. No unpublish.** After publishing, a supervisor's only route is a change request (FR-RS-35/36). The SRS has no unpublish.

**D8. Multi-location staff.** Leave is approved by a supervisor of the person's `homeLocationId`, else by an office role.

**D9. Rules are pure and configurable.** `lib/roster-rules.ts`, severities in `rosters/rules.json`. The 48-hour average uses a 17-week reference (about the Act's 4 months), as data. Rest and hours are computed from real elapsed time, so DST is right. A clash at a location the supervisor can't see says "Already rostered elsewhere" with no site or time.

**D10. Repeat.** A failing shift becomes an open shift plus a conflict line. A public holiday is an information line only and the person stays rostered, because these sites work holidays. Repeat refuses a target week that is published; a target draft needs an explicit replace.

**D11. Entitlements.** New product module `M1A` ("Rostering") in Business and Enterprise. `M8` is renamed `M1C`. `M1B` is added when it is built.

**D12. Cover link.** An open shift appears as a derived roster gap in Staff & Rosters, and the two link to each other. Recording cover there doesn't assign the roster shift in this mock.

**D13. Mock limits.** Edits live in client stores until reload, so a roster published in a session doesn't reach server-built shift reports. "The API refuses" (AC-RS-05) can only be shown as disabled controls and a pure guard, until a backend exists.

## Left to the builder

Exact copy, spacing within OpsDesk tokens and rules 30–32 of `ui-rules.md`, and seed volume (enough to make each view meaningful).
