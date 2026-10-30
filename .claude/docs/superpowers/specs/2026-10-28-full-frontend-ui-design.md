# OpsDesk full frontend UI: design

Date: 2026-10-28 · Status: draft for approval
Source of truth for requirements: `.claude/docs/requirements/SRS-v1.2-built.md` (then v1.1). Section numbers below refer to it.

## 1. Intent

OpsDesk is a multi-tenant SaaS for security and cleaning companies.
The people who will judge this UI are **corporate clients (SaaS users)**: the owner, managers and staff of a company that buys OpsDesk.
They must open it and recognise their own daily operations.

The owner/manager dashboard (`/`) already exists and is the visual reference.
This project builds **every remaining screen** in the SRS as a working, data-driven frontend:
- mock JSON data
- shadcn components for behaviour
- the OpsDesk theme for looks

That includes a **staff (employee) view**, because the SRS dashboards are role-based (§2.2, §10.1).

"Working" means a click-through that behaves like the product. It is not a slideshow of static mock-ups.

## 2. Goals
1. Every SRS §5.1 screen exists, plus the SaaS screens from §3.20:
   - sign-up and onboarding
   - settings, users and invites
   - plan and billing
   - the platform super-admin console
2. Role-based experience (§2.3, §10.1):
   - The same app shows different dashboards, navigation and access depending on the signed-in role.
   - A staff member sees their own work only.
3. Each screen covers the fields, statuses and actions its SRS section lists. Examples:
   - all 7 task statuses (FR-TASK-02)
   - the 10-section report and its lifecycle (§4, §4.2)
   - manager-attention fields (FR-REV-04)
4. The UI is consistent with the existing dashboard (`app/opsdesk.css`, `ui-rules.md`) in light and dark mode, and works on Android widths without horizontal scroll (FR-MOB-01).

## 3. Non-goals
- Real backend, real authentication, real Stripe, Drive, WhatsApp or transcription. Integration screens show configuration and status from JSON only.
- Data that persists across reloads. Changes live in client state and reset on reload.
- Payroll calculation (§2.6), roster optimisation, a native app.

## 4. Anti-goals: things that would make this a failure even if it "works"
- shadcn default look leaking in. That means grey accents, 1px borders, small radius or default focus rings. See `ui-rules.md` rules 1–10.
- Hard-coded tenant values. All of these come from JSON (NFR-CONF-01, CLAUDE.md):
  - company name
  - department names
  - deadline and timezone
  - branding
  - plan names and limits
- Breaking or restyling the existing owner dashboard.
- Any covert-monitoring or "ghost account" UI (§2.6, BR-12).
- Colour-only status (§5.2, NFR-ACCESS-01). Every status shows a text label.
- A page without an exact skeleton, or animations that break the Motion rules.

## 5. Constraints (fixed by the project)
- Next.js 16 App Router. Read `node_modules/next/dist/docs/` before using unfamiliar APIs (AGENTS.md).
- Feature-based architecture (`.claude/docs/architecture.md`):
  - one `features/<feature>/` per module
  - data in `public/data/<feature>/*.json`, read by `api.ts` through `lib/data.ts`
  - no cross-feature imports
  - shared code goes in `components/`, `hooks/` and `lib/`
- shadcn (`components/ui`, base-nova style, base-ui) provides behaviour only. Each component is re-skinned with OpsDesk tokens in `app/opsdesk.css`. Missing components are added with `npx shadcn add`. Examples: popover, calendar, textarea, radio-group, switch, accordion, command.
- Each page and each data-driven component gets an exact skeleton and a `loading.tsx` (`architecture.md` → Skeletons).
- Motion follows `ui-rules.md` → Motion:
  - tokens
  - `motion/react` only for its four uses
  - scroll reveal
  - reduced motion
- Timezone is shown next to every deadline and timestamp (§5.2). Destructive actions ask for confirmation.
- Each new route is a static folder in `app/(app)/`. It replaces the `[section]` "Coming soon" page automatically.

## 6. Decisions made in this design

### 6.1 Roles and how the client sees them
- The session is mocked. A `role` (and `tenant`) lives in a cookie and is read on the server by a small `lib/session.ts`. The default is the existing owner/manager user.
- A **"View as" role switcher** sits in the NavUser menu:
  - The roles come from `public/data/shell/roles.json`.
  - Each role has a label and permission keys per module.
  - This is how the corporate client can walk through every role in one demo.
  - It is clearly labelled as a preview, so it is not a hidden account.
- Preview roles (§2.3):
  - Tenant Owner
  - Tenant Admin
  - Designated Manager
  - Operations Manager / Report Owner
  - Supervisor
  - Employee
  - HR
  - Payroll
  - Auditor (read-only)
- **Sidebar** items are filtered by the role's permissions.
- **A page the role cannot access** shows an "Access restricted" state. It mirrors the server-side denial of UAT-11 and says the attempt is logged.
- **Read-only roles** see no edit or create controls.
- **`/` dashboard by role:**
  - owner and managers: the existing dashboard
  - Employee and Supervisor: a new **staff dashboard** (§10.1) with
    - my open tasks and due dates
    - overdue or blocked tasks
    - evidence awaiting review or returned
    - today's report status and deadline, if they own a report
    - my recent submissions and manager comments
  - HR, Payroll, Auditor: the staff dashboard variant, limited to their modules

### 6.2 Tenant (SaaS) context in the shell
- A **tenant switcher** in the NavUser menu (FR-SAAS-13). Its tenants come from JSON.
- Tenant branding comes from JSON (FR-SAAS-11): name, logo initials and brand colour.
- A **subscription banner** in the shell when the tenant is `trial`, `past_due` or `suspended` (FR-SAAS-08). A suspended tenant is read-only and export stays allowed.
- In-app **notifications** open from the existing topbar bell as a panel (FR-NOT-01). They are grouped by type, with mark-read. No sensitive details appear in previews (FR-NOT-04).

### 6.3 Screens (route → content)
All screens get department and date filters and search where the SRS asks for them (FR-AUD-01). Lists support empty states.

Phase 1, core:
- **`/` staff dashboard** (see 6.1).
- **`/tasks`** (§3.3)
  - Filterable list: status, priority, department, assignee and due date. Table on desktop, cards on mobile.
  - "New task" dialog with the FR-TASK-01 fields.
- **`/tasks/[ref]`** (task detail)
  - the description and its fields
  - status changes, which follow the FR-TASK-02 lifecycle
  - a timeline/audit of changes (FR-TASK-04)
  - progress notes
  - evidence:
    - upload UI, with no real upload
    - review: accept, reject with a reason, or request info (FR-TASK-07)
  - an on-time/late flag (FR-TASK-08)
  - for overdue tasks: reason, next action and revised date (FR-TASK-09)
  - a clear split between "Submitted for review" and "Completed" (FR-TASK-12)
- **`/daily-reports`** (§3.4–3.5, §10.3)
  - **Manager view:**
    - a submission status board by department and owner: due, submitted, overdue, returned, reviewed
    - the review queue
    - historical reports filtered by date, department, owner and status
  - **Report owner view:** today's report card with its deadline countdown.
- **`/daily-reports/[id]`**
  - **Form** (owner, draft or returned):
    - the header from §4
    - 10 collapsible sections
    - a per-field state: No issues / Action required / N/A / Details provided (FR-REP-05)
    - multiple entries per field (FR-REP-04)
    - a progress indicator and a sections-needing-attention list (§4.1)
    - save draft, validation with fix-it messages (UAT-07), nil/clear report (BR-04) and submit
  - **Read/review mode** (reviewer):
    - all sections
    - comments
    - Accept, or Return for correction with a comment (FR-REP-09)
    - follow-up task creation
    - version/amendment history (FR-REP-10)
    - print/export buttons. They are UI only and log the export (FR-AUD-05).
- **`/manager-attention`** (§3.5, §3.14)
  - The queue lists each item's summary, impact/urgency, requested decision, owner, due date and status.
  - A decision dialog records the decision and the resolution note, with decision-maker and timestamp (FR-REV-05).
  - Outstanding carry-forward items, whose closure requires a resolution note (FR-OUT-05).

Phase 2, operations modules (each has a list, filters, a detail sheet or dialog, and add/edit forms for its SRS fields):
- **`/staff-rosters`** (§3.6, §3.8)
  - attendance incidents: call-out, no-show, cover arranged
  - roster gaps for today, tomorrow and next week, with owner and next action
  - sensitive fields hidden for unauthorised roles
- **`/recruitment`** (§3.9): candidates by stage, as a pipeline/kanban or a list; next action and owner.
- **`/files`** (§3.10–3.11)
  - Tabs for Employee documents and Client files.
  - Each document shows type, subject, received date, expiry and status.
  - Expiring and missing documents are highlighted.
  - A document needs manual "confirm valid" (FR-EFILE-05).
- **`/payroll-issues`** (§3.12): restricted. Issues show reference, description, owner, target date, status and resolution.
- **`/orders-stock`** (§3.13): orders show item, qty, supplier, requester, approval and delivery. An approve/reject flow is available to approvers.

Phase 3, admin and audit:
- **`/settings`**, with sub-pages or tabs:
  - **Organisation:** name, timezone, report deadline, weekend and holiday rule
  - **Departments, sites and teams** (FR-ORG-02)
  - **Users and invitations:**
    - invite by email with role and department
    - invitations can expire and be revoked
    - users can be deactivated and reactivated (FR-AUTH-02, FR-SAAS-05)
  - **Roles and permissions:** a matrix you can view and edit
  - **Report template** (§4, per-department configuration, FR-ORG-04)
  - **Notifications:** reminder intervals and channels (FR-NOT-02/04)
  - **Integrations** (§9): Drive, WhatsApp, email, transcription, each with status, connect button and last event
  - **Branding** (FR-SAAS-11)
  - **Plan and billing** (FR-SAAS-06/07):
    - current plan and usage against limits
    - invoices
    - payment status
    - buttons for "Change plan" (Checkout) and "Manage billing" (Portal), which do nothing real
    - the provider name comes from JSON, so the billing UI is provider-agnostic (FR-SAAS-07a)
  - **Data and privacy:**
    - export all data, and request deletion (FR-SAAS-15)
    - support access grants that are time-limited and visible (FR-SAAS-10)
    - the session timeout policy (FR-AUTH-07)
- **`/audit-log`** (§3.19): an append-only event list showing actor, action, record, time and IP/device. Filters, plus a logged export.

Phase 4, outside the tenant app (new route groups with their own minimal layouts, no AppShell):
- **`(auth)`:**
  - `/sign-in`, with an MFA step screen
  - `/forgot-password`
  - `/sign-up`, a multi-step flow: organisation, owner account, verify-email screen, plan or trial
  - `/onboarding`, a guided setup:
    - departments, with Security and Cleaning pre-seeded but editable
    - timezone and deadline
    - report template
    - invite users
- **`(platform)` `/platform`** (FR-SAAS-09/10): the Platform Super Admin console, with its own navigation JSON.
  - a tenants list with status, plan, usage and suspend/reactivate
  - tenant detail, which deliberately shows no operational data
  - plans and limits
  - support-access requests
  - platform audit

### 6.4 Interaction model
- Pages are server components. They load JSON through the feature's `api.ts` and the session role, and pass props down.
- Interactive parts are client components holding local state that starts from the props. Creating, updating or deciding changes the list immediately.
- Changes confirm with a toast (sonner, re-skinned) and append an entry to the record's local timeline.
- Forms validate on submit with clear messages, and destructive actions use a confirm dialog.
- Reload resets to the JSON.

### 6.5 Mock data
- Realistic UK security and cleaning operations, consistent across modules: the same staff names, clients, sites, task refs (TSK-…) and dates.
- Amounts: 10–25 rows per list, enough for filters and empty states to make sense.
- All dates are relative to a fixed "today" stored in JSON, so the demo never goes stale.
- Shared enums (status labels, tones) go in `lib/types.ts`.

### 6.6 Settled after the builder check (designer's calls)
- **Tenant switcher.** Switching tenant changes only tenant-level data: name, branding, plan, subscription status and the banner. This data comes from `public/data/shell/tenants.json`. Operational data (tasks, reports and so on) is single-tenant mock data shared by every tenant. The JSON folders are **not** split per tenant.
  - The second tenant exists to demo the trial and past-due states.
- **Cross-page persistence.** Changes survive client-side navigation but reset on reload.
  - Each feature has a small in-memory client store (`useSyncExternalStore`), seeded once from the server props.
  - Example: a task created on `/tasks` shows up on `/tasks/[ref]`.
  - There is no global store in the layout and no sessionStorage. Server components still load the JSON and pass it as props.
- **Owner dashboard stays as is.** Its numbers, its date and the sidebar badges are kept consistent with the new JSON by hand, not derived. The fixed "today" for all mock data is the dashboard's date, **Tuesday 20 October 2026**. It lives in one JSON file that every feature reads.
- **Platform console access.**
  - The "View as" switcher has a separate "Platform Super Admin" entry, which sets the cookie and goes to `/platform`. Direct URL access to `/platform` also works.
  - The `(auth)` pages can be browsed.
  - Submitting sign-in sets the role cookie and redirects to `/`.
  - Sign-out clears the cookie and goes to `/sign-in`.
  - No middleware. Each layout checks the session cookie and redirects.

## 7. How it gets built (user's instructions)
- The plan and the reviews are done by **Opus 5.5**. Implementation is done by **Sonnet 5.5** subagents (superpowers subagent-driven development).
- **The user approved 2026-10-28.** Run all four phases back to back through subagents, with no stop for approval between phases. Phase 4 is included: sign-in, sign-up and onboarding, and the platform console.
- The phase order is 1 → 4. Each phase ends with:
  - `tsc` clean and eslint clean on changed files
  - a browser check in light and dark, plus a mobile-width check, when the browser extension is connected
  - docs updated in `.claude/docs`, including a per-feature brief and the README index
- Commits happen only when the user asks.

## 8. Left to the builder
- Exact layout of each page, as long as it uses the existing visual language: cards, `.card-head`, `.item`, tables, pills and the seg control.
- JSON shapes per feature and the exact mock content.
- Which shadcn primitives each screen uses, and whether a detail opens as a page, a sheet or a dialog. The rule of thumb: tasks and reports get pages, everything else gets a sheet.
- How shared UI is factored, for example a status pill, filter bar, data table, form field, page header and empty state, which move to `components/` once two features need them.
