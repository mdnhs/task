<!-- Converted from public/Office_Operations_SRS_v1.0.docx (v1.0, 16 Oct 2026).
     v1.1 (28 Oct 2026) adds the SaaS / multi-tenant requirements. These exist only in this markdown, not in the .docx.
     Do not re-convert the .docx over this file without carrying the v1.1 additions across. Search "v1.1" to find them.
     v1.2 (28 Oct 2026) aligns this file with the built frontend prototype (§3.21-§3.31, Appendices A-B). Search "v1.2" to find the changes. -->

# Software Requirements Specification

**Office Operations, Task Management & Daily Reporting System**

A multi-tenant SaaS product for Security and Cleaning Operations

Version 1.2 | Draft for Client Review
28 October 2026

Prepared as a development baseline from the requirements shared by the client. Items marked Pending Client Confirmation must be approved before the relevant feature is finalised.

## Document Control

| **Field** | **Value** |
|---|---|
| Document title | Software Requirements Specification (SRS) |
| System name | Office Operations, Task Management & Daily Reporting System (working title) |
| Version | 1.2 – Draft for client review (adds SaaS / multi-tenancy; aligned with the built frontend prototype) |
| Product model | Multi-tenant SaaS: many client organisations (tenants) on one platform, each with isolated data |
| Status | Requirements baseline; not yet client-approved |
| Primary business areas | Security services and Cleaning services |
| Primary deadline | Daily end-of-day report due by 5:30 PM; timezone to be confirmed |
| Business decision contact | Lilianna (role and approval authority to be confirmed) |
| Prepared for | Client and delivery/development team |

### Revision History

| **Version** | **Date** | **Description** |
|---|---|---|
| 1.0 | 16 October 2026 | Initial consolidated draft based on the two client messages. |
| 1.1 | 28 October 2026 | Product is a SaaS. Adds multi-tenancy, onboarding, subscriptions and billing (Stripe now, behind a provider-agnostic module so more payment methods can be added later), and a platform admin console (§3.20). Also updates scope, roles, the data model, NFRs, phases, risks, open questions and architecture. |
| 1.2 | 28 October 2026 | Aligned with the built frontend prototype so this file can be the source of truth for future work. Adds §3.21 to §3.31 (role and module access, global search, AI assistant, branding, platform console, in-tenant billing, account page, settings area, sign-up and onboarding, application shell, implementation notes for operations modules) and implementation notes for existing modules (FR-xxx-nn entries marked v1.2). Changes FR-AUD-01, FR-SAAS-03, FR-SAAS-07a, FR-SAAS-11 and §2.3 (see "Changed v1.2" notes). Adds §5.3 route map, §6.4 additional entities, Appendix A (traceability), Appendix B (mock / frontend-only status) and open questions OC-22 to OC-29. No existing requirement ID was renumbered or removed. |

### Approval

| **Approver** | **Approval role** | **Status / date** |
|---|---|---|
| Client representative | Business owner / authorised approver | Pending |
| Lilianna | Operational approver (confirm role) | Pending |
| Project manager | Delivery coordination | Pending |
| Technical lead | Architecture and implementation feasibility | Pending |

## 1. Introduction

### 1.1 Purpose

This SRS defines the functional and non-functional requirements for a centralised office operations platform. The platform will manage tasks, operational updates, daily reports, supporting evidence, employee and client records, staffing/rosters, recruitment, payroll-related issues, stock/order tracking, management escalations, and selected integrations. It is intended to guide UX/UI design, implementation, testing, deployment, and client acceptance.

### 1.2 Scope

The proposed system will provide a role-based web application that is responsive on desktop and Android browsers. It will support Security and Cleaning operations, daily end-of-day reports, task assignment and follow-up, report review, and management oversight. Integrations with Google Drive and WhatsApp, and voice-to-text, are in scope subject to technical feasibility, third-party access, licences, policies, and client confirmation.

**SaaS model (v1.1).** The system shall be delivered as a multi-tenant Software-as-a-Service product, not a single-company installation.
- Each subscribing organisation (tenant) gets its own isolated workspace. That workspace holds its users, departments, report template, deadline, timezone, branding and integrations.
- The original client is the first (launch) tenant. Every client-specific value in this document is a per-tenant setting, not a platform constant. This includes the Security and Cleaning departments, the 5:30 PM deadline, the ten-section report and the named approver.

### 1.3 Business objectives

- Replace fragmented reporting with one consistent daily reporting process.
- Ensure daily reports are submitted by the agreed 5:30 PM deadline.
- Give management a clear view of each employee's tasks, submissions, outstanding work, and blockers.
- Capture evidence for selected tasks and support review/approval.
- Escalate decisions and unresolved issues to Lilianna or the designated manager.
- Provide secure access from allocated office PCs and Android devices, with a defined Google Drive access policy.
- Reduce manual follow-up through reminders, status dashboards, and searchable history.

### 1.4 Intended audience

- Client/business owner and operational managers
- Lilianna and authorised report reviewers
- Security and Cleaning team members
- Recruitment, HR, payroll, roster and stock/order staff
- Project manager, UX/UI designer, developers, QA/testers and support staff

### 1.5 Definitions and abbreviations

| **Term** | **Definition** |
|---|---|
| SRS | Software Requirements Specification. |
| EOD | End of day. |
| RBAC | Role-based access control. |
| Evidence | File, image, link, note, or other proof attached to a task/report. |
| Ghost account | Unclear client phrase; exact purpose and visibility rules require confirmation. |
| Allocated PC | Office computer designated by the client for permitted access, particularly Google Drive. |
| Report owner | Person responsible for completing/submitting a report. |
| Escalation | An issue requiring a manager's decision or action. |
| Tenant (v1.1) | One subscribing organisation and its isolated workspace, data and settings. |
| Platform operator (v1.1) | The company that runs the SaaS product and serves all tenants. |
| Plan (v1.1) | A subscription tier that sets price, limits (users, storage, modules) and features. |
| SaaS (v1.1) | Software as a Service: hosted, subscription-based, multi-tenant delivery. |

### 1.6 Requirement priority

MUST = required for initial acceptance; SHOULD = strongly recommended; COULD = optional or later phase. Priority may change after client sign-off.

## 2. Overall Description

### 2.1 Product perspective

The platform is a central operational workspace rather than only a report form. Tasks, report entries, evidence, unresolved issues and management decisions should be linked where practical, so that the daily report can show current operational status without requiring users to re-enter the same information unnecessarily.

(v1.1) The platform is sold as a SaaS product to many security and cleaning companies.
- Every operational record belongs to exactly one tenant.
- Users act inside the tenant they signed in to.
- Platform-level functions (tenants, plans, billing, support) are kept separate from tenant-level operations.

### 2.2 Proposed operating model

- Authorised users sign in and see a dashboard based on their role.
- Managers create or assign tasks with owners, deadlines, priorities, department and evidence requirements.
- Employees update task status and submit notes/evidence.
- The designated report owner completes the ten-section daily report for the relevant date and department.
- The system validates required fields and records the submission timestamp.
- Management reviews the report, returns it for correction if needed, and assigns follow-up actions.
- Outstanding items remain open until resolved and are carried forward or referenced in the next report.

### 2.3 User classes and permissions

| **Role** | **Expected permissions (proposed; confirm with client)** |
|---|---|
| Platform Super Admin (v1.1) | Platform operator staff. Manages tenants, plans, billing status, platform settings and support. Cannot see tenant operational data unless the tenant grants time-boxed, audited support access. |
| Tenant Owner (v1.1) | Created at tenant sign-up. Manages the subscription, billing details, tenant settings and Tenant Administrators. |
| System Administrator (Tenant Admin) | Within one tenant only: manage users, roles, configuration, integrations, retention and audit access; should not automatically have unrestricted access to sensitive content unless authorised. |
| Owner / Senior Management | View cross-department dashboards and reports; manage tasks and deadlines; review escalations; approve decisions. |
| Lilianna / Designated Manager | Review reports and manager-attention items; request corrections; assign or close actions; approve defined requests. |
| Operations Manager / Report Owner | Maintain daily operational data and submit consolidated report(s) for assigned department(s). |
| Department Supervisor / Team Lead | Manage tasks and staff updates for authorised team; verify evidence; prepare relevant report sections if permitted. |
| Employee / Staff Member | View assigned tasks, update status, submit evidence and own updates; access only permitted records. |
| HR / Recruitment User | Access recruitment and employee-document modules as authorised. |
| Payroll User | Access payroll issue records and required supporting information only. |
| Read-only / Auditor | View permitted records and audit history without editing. |
| Ghost account | Not defined; do not implement until purpose, identity, visibility, authentication and audit expectations are approved. |

Changed v1.2: the built prototype implements the role and module matrix in §3.21 (ids `owner`, `admin`, `manager`, `ops`, `supervisor`, `employee`, `hr`, `payroll`, `auditor`, `platform`). "Owner / Senior Management" is covered by Tenant Owner; "Lilianna / Designated Manager" is the tenant-configurable Designated Manager role. The matrix is a delivery-team proposal pending OC-22. Ghost account is still not implemented.

### 2.4 Supported environments

- Desktop web browsers on the client's supported office PCs.
- Android mobile browsers; responsive layouts for task updates, report review and evidence upload.
- Current stable versions of major browsers should be supported at implementation time; exact browser/device matrix to be agreed during testing.
- No native Android application is assumed in the initial scope; a responsive web app/PWA is the default proposal unless the client requests a native app.

### 2.5 Assumptions and dependencies

- The client will nominate a business owner and confirm who submits each daily report.
- The client will provide approved user lists, departments, role permissions, reporting timezone and operational rules.
- Google Drive integration depends on account type, Google Workspace configuration, OAuth consent and security policy.
- WhatsApp integration depends on the chosen supported approach, normally WhatsApp Business Platform or an approved provider; ordinary personal WhatsApp automation is not assumed.
- Voice-to-text quality depends on audio quality, language/accent, supported provider and privacy/consent requirements.
- Payroll functionality in this scope is issue tracking, not payroll calculation or payment processing unless separately approved.
- The platform does not independently verify real-world work unless an approved data source or evidence process is configured.

### 2.6 Out of scope unless separately approved

- Full payroll calculation, payslips, bank transfers or accounting integration.
- Automatic employee surveillance, keylogging, covert recording or hidden monitoring.
- A native Android/iOS app.
- Full HRIS, applicant tracking, contract-signing or document management suite beyond the stated workflows.
- Automated rostering optimisation or payroll compliance calculations.
- Unapproved scraping or automation of personal WhatsApp accounts.
- Any invisible/undisclosed access account or monitoring function.

## 3. Functional Requirements

### 3.1 Authentication and account management

**FR-AUTH-01** (MUST): The system shall require an authenticated user session for all non-public pages.

**FR-AUTH-02** (MUST): Administrators shall create, deactivate and reactivate accounts, assign roles and associate users with departments/teams.

**FR-AUTH-03** (MUST): The system shall enforce server-side role and record-level access controls; hiding a button alone is not sufficient.

**FR-AUTH-04** (SHOULD): The system should support multi-factor authentication where supported by the identity provider.

v1.2 status: the sign-in flow has a six-digit code step and the account security tab can turn two-step verification on or off (§3.27, §3.29). Both are simulated; any six digits pass.

**FR-AUTH-05** (MUST): Password reset or account recovery shall use a secure, verified process.

**FR-AUTH-06** (MUST): The system shall record key security events such as sign-in, failed sign-in, role change, account deactivation and sensitive export.

**FR-AUTH-07** (MUST): The system shall automatically expire inactive sessions according to a configurable policy.

**FR-AUTH-08** (MUST): The system shall not implement a covert or unlogged account. Any special administrative/test account must be approved, named, access-controlled and audited.

### 3.2 Organisation and department setup

**FR-ORG-01** (MUST): The system shall support at least the Security and Cleaning departments. (v1.1) These are the default departments seeded for a new tenant. Each tenant can rename, add or remove departments.

**FR-ORG-02** (MUST): An authorised administrator shall be able to add/edit departments, teams, locations and reporting owners.

**FR-ORG-03** (MUST): Each task, report and issue shall be associated with a department and, where applicable, a location/client.

**FR-ORG-04** (SHOULD): The system should allow separate report templates or configuration by department while preserving a shared management view.

### 3.3 Task management

**FR-TASK-01** (MUST): Authorised users shall create tasks with title, description, department, assignee, creator, priority, start date, due date/time, status and optional related client/report.

**FR-TASK-02** (MUST): Tasks shall support statuses: Not Started, In Progress, Blocked, Submitted for Review, Changes Requested, Completed and Cancelled.

**FR-TASK-03** (MUST): Authorised managers shall assign, reassign, edit, archive/cancel tasks and change deadlines.

**FR-TASK-04** (MUST): The system shall record the user and timestamp for material task changes, including deadline, owner, status and priority changes.

**FR-TASK-05** (MUST): Employees shall add progress notes and submit configured evidence before marking evidence-required tasks as ready for review.

**FR-TASK-06** (MUST): Evidence may include approved file types, images, links and text notes; file size/type limits shall be configurable.

**FR-TASK-07** (MUST): Reviewers shall be able to accept evidence, reject it with a reason, or request more information.

**FR-TASK-08** (MUST): The system shall calculate whether a task is on time or late using its due date/time and completion/submission timestamp.

**FR-TASK-09** (MUST): For overdue/incomplete tasks, users shall be able to record a reason, next action, responsible person and revised due date.

**FR-TASK-10** (SHOULD): Tasks should support recurring schedules, task templates, dependencies and tags.

v1.2 status: tags, recurring tasks and task templates are built as a mock (FR-TASK-15). Dependencies are not built.

**FR-TASK-11** (MUST): Completed tasks shall remain searchable according to the retention policy; deletion of business records should be restricted and auditable.

**FR-TASK-12** (MUST): The system shall distinguish task submission from reviewer-approved completion.

### 3.4 Daily end-of-day report

The report is due by 5:30 PM every day. The timezone and whether the deadline applies on weekends, public holidays, or non-working days must be confirmed.

**FR-REP-01** (MUST): The system shall provide a dated Daily End-of-Day Report for Security and Cleaning operations.

**FR-REP-02** (MUST): The report shall contain the ten sections and fields defined in Section 4 of this SRS.

**FR-REP-03** (MUST): The report shall identify report date, department, report owner, created time, last updated time, submission time and review status.

**FR-REP-04** (MUST): The report shall allow multiple entries under a field where more than one issue/person/item exists.

**FR-REP-05** (MUST): Each applicable field shall support a clear state such as No issues, Action required, Not applicable or Details provided, where appropriate.

**FR-REP-06** (MUST): The system shall validate mandatory fields and warn about incomplete sections before submission.

**FR-REP-07** (MUST): A report owner shall be able to save a draft and return later before submission.

**FR-REP-08** (MUST): On submission, the system shall record an immutable submission timestamp and change status to Submitted.

**FR-REP-09** (MUST): An authorised reviewer shall be able to mark a report Reviewed/Accepted or Return for Correction with comments.

**FR-REP-10** (MUST): If a submitted report is edited, the system shall preserve an audit trail and identify the amended version; the original submission must not be silently overwritten.

**FR-REP-11** (MUST): The system shall show due, submitted, overdue and reviewed states on the management dashboard.

**FR-REP-12** (SHOULD): The system should generate a printable/exportable PDF and spreadsheet-friendly report, subject to access permissions.

v1.2 status: BUILT (mock data). Export menu (PDF or Excel) in the `/daily-reports` page head (staff: own report; reviewers and managers: the day's submission board), on the report history card (the filtered rows) and on the report page (that report). Files are made in the browser with jsPDF and ExcelJS, loaded only on click (`features/reports/export.ts`, rows in `export-rows.ts`). The header has the tenant name, the tenant-timezone date and the tenant brand colour. File names look like `daily-report-<dept>-<YYYY-MM-DD>`. Payroll is left out for roles that cannot read it. A toast confirms the download and the button shows a spinner while the file is made. Not built: logging the export in the audit trail (FR-AUD-05).

**FR-REP-13** (SHOULD): The system should pre-fill linked information from tasks/rosters/recruitment records where feasible, with the report owner able to review it before submission.

v1.2 status: BUILT for the owner's draft of today. The route `/daily-reports/[id]` reads tasks, staff rosters and recruitment through their feature barrels (only for modules the role may read) and maps them with the pure `lib/report-prefill.ts`. The report page shows a "Fill from linked records" banner with a Use suggestions button. Only fields with no answer are filled, each is marked Pre-filled until edited, and nothing is saved or submitted for the owner. Sources: department tasks that are open and due today or earlier (Outstanding), today's call-outs, no-shows, cover and staff issues, roster gaps for today, tomorrow and next week, and recruitment stage moves made today (counts). Fields with no source are left alone. Shared data layer between modules is still open (OC-27).

**FR-REP-14** (MUST): The system shall support a report for each applicable date even when there are no incidents; users should be able to submit a nil/clear report.

### 3.5 Report review and management actions

**FR-REV-01** (MUST): Reviewers shall see all report sections, outstanding items and attached evidence permitted by their role.

**FR-REV-02** (MUST): Reviewers shall be able to add comments, request corrections, assign follow-up tasks and set deadlines.

**FR-REV-03** (MUST): Items requiring Lilianna's decision shall appear in a dedicated Manager Attention Required queue.

**FR-REV-04** (MUST): A manager-attention item shall include a summary, impact/urgency, requested decision, owner, due date and status where applicable.

**FR-REV-05** (MUST): Decisions and resolution notes shall be recorded with the decision-maker and timestamp.

**FR-REV-06** (SHOULD): The dashboard should highlight urgent unresolved issues and items that have passed their follow-up deadline.

### 3.6 Staff and attendance

**FR-STAFF-01** (MUST): The report shall capture call-outs, no-shows, cover arranged and outstanding staff issues.

**FR-STAFF-02** (SHOULD): Each staff incident should optionally link to a staff member, shift, site/client and cover person.

**FR-STAFF-03** (MUST): Sensitive staff details shall be visible only to authorised roles.

**FR-STAFF-04** (SHOULD): The system should maintain an action/status history for unresolved staff issues.

### 3.7 Client issues

**FR-CLIENT-01** (MUST): Users shall record client contacted, complaints, requests and outstanding issues.

**FR-CLIENT-02** (SHOULD): Client issue records should support client/site, date/time, contact method, issue category, urgency, owner, next action and resolution.

**FR-CLIENT-03** (MUST): Complaint records shall have an auditable history of status changes and responses.

**FR-CLIENT-04** (MUST): Client information shall be limited to users with an operational need.

### 3.8 Rosters and coverage

**FR-ROSTER-01** (MUST): The report shall record today's roster issues, tomorrow's cover and next week's gaps.

**FR-ROSTER-02** (SHOULD): Users should be able to create a roster issue with shift/date, site, role, assigned staff, coverage status and notes.

**FR-ROSTER-03** (MUST): Unfilled coverage needs shall be traceable to an owner and next action.

**FR-ROSTER-04** (COULD): Automated roster generation or optimisation may be added in a later phase.

### 3.9 Recruitment

**FR-REC-01** (MUST): The report shall capture applications reviewed, candidates contacted, interviews arranged, new starters and outstanding candidates.

**FR-REC-02** (SHOULD): A basic candidate record may include name, contact details, role, stage, last contact, next action and owner.

**FR-REC-03** (MUST): Access to candidate personal data shall be restricted to authorised recruitment/management users.

**FR-REC-04** (MUST): Candidate records shall follow the client's approved retention and deletion policy.

### 3.10 Employee files and document expiry

**FR-EFILE-01** (MUST): The report shall capture files updated, documents received, missing documents and expiring licences/documents.

**FR-EFILE-02** (SHOULD): Document records should support document type, staff member, received date, expiry date, status and secure file/link reference.

**FR-EFILE-03** (SHOULD): The system should notify authorised users before configured document expiry dates.

**FR-EFILE-04** (MUST): Employee documents shall be stored or linked securely and never exposed to unauthorised users.

**FR-EFILE-05** (MUST): The system shall not treat a document as valid solely because a file is uploaded; authorised staff must confirm its status where required.

### 3.11 Client files

**FR-CFILE-01** (MUST): The report shall capture client files updated, contracts, contact details and outstanding paperwork.

**FR-CFILE-02** (SHOULD): A client record should include approved business details, site/location, authorised contacts, contract references and document status.

**FR-CFILE-03** (MUST): Contract and client-document access shall be role-restricted and auditable.

### 3.12 Payroll issue tracking

**FR-PAY-01** (MUST): The report shall capture payroll issues identified, corrections required and outstanding information.

**FR-PAY-02** (MUST): The system shall treat these as issue-tracking records only unless payroll calculation is explicitly added to scope.

**FR-PAY-03** (MUST): Payroll details shall be restricted to specifically authorised roles; the general employee dashboard must not expose payroll information.

**FR-PAY-04** (SHOULD): Each issue should include a reference, description, assigned owner, target date, status and resolution note.

### 3.13 Orders and stock

**FR-STOCK-01** (MUST): The report shall capture orders placed, deliveries received, items required and approvals waiting.

**FR-STOCK-02** (SHOULD): An order/stock item should include item description, quantity, supplier/reference, requester, approval status, expected date and delivery status.

**FR-STOCK-03** (MUST): Items waiting for approval shall be visible to the authorised approver and have a clear status.

**FR-STOCK-04** (COULD): Inventory quantity tracking and purchase-order workflows may be added if approved.

### 3.14 Outstanding tasks and issue carry-forward

**FR-OUT-01** (MUST): The report shall capture tasks not completed today, the reason, and action required.

**FR-OUT-02** (MUST): Each outstanding item shall support owner, priority, next action and target date where applicable.

**FR-OUT-03** (MUST): Unresolved issues shall remain visible after the report is submitted and shall not disappear when a new day's report is created.

**FR-OUT-04** (SHOULD): The next report should show prior unresolved items for confirmation, update or closure rather than silently duplicating them.

**FR-OUT-05** (MUST): Closure shall require a resolution note for configured issue types.

### 3.15 Notifications and reminders

**FR-NOT-01** (MUST): The system shall show in-app notifications for task assignment, reassignment, deadline changes, evidence review, report return and manager actions.

**FR-NOT-02** (SHOULD): The system should send reminders before the 5:30 PM report deadline at client-approved intervals.

v1.2 status: BUILT (mock). `lib/notify.ts` `reminderSchedule` turns the tenant offsets (Settings → Notifications), the report deadline from org data and the user's lead time (only when the tenant lists it as an allowed option, FR-ACC-03) into reminder times. Nothing is sent; real sending needs a provider.

**FR-NOT-03** (SHOULD): The system should notify designated managers when a report is overdue or an urgent item is escalated.

v1.2 status: BUILT (mock). `dueReminders` fires reminders for departments with no submitted report until the deadline, then overdue alerts to the designated manager roles (a tenant setting, matched against the users data). The shell bell shows them as "reminder" items through `hooks/use-notify-feed.ts`; the Settings → Notifications "Mock clock" menu moves the clock to try it. Urgent-item escalation is still the Manager Attention flow. Real sending needs a provider.

**FR-NOT-04** (MUST): Notification channels and timing shall be configurable; the system shall avoid exposing sensitive details in notification previews.

**FR-NOT-05** (MUST): The application shall record delivery/processing status where the notification provider supports it.

v1.2 status: BUILT (mock). `deliveries` gives one record per channel (queued, sent, delivered, failed, skipped, with a reason for skipped and failed). Settings → Notifications has a Delivery log table (filter by channel and status, paged) seeded from `public/data/settings/delivery-log.json`. No provider reports status yet.

### 3.16 Google Drive access and restriction

**FR-GDR-01** (MUST): The system shall support the agreed Google Drive workflow only after the client specifies whether this means a link, embedded listing, file picker, or API integration.

**FR-GDR-02** (MUST): If Drive is permitted only from allocated office PCs, access enforcement shall use an appropriate identity/device policy or managed environment; hiding mobile links is insufficient.

**FR-GDR-03** (MUST): Android users shall not be granted Drive access through this application if the approved policy prohibits it, while other permitted system features remain available.

**FR-GDR-04** (MUST): The system shall not store Google passwords. Any API integration shall use an approved OAuth flow and least-privilege scopes.

**FR-GDR-05** (MUST): Access restrictions must be tested against direct URLs, cached sessions, downloads and alternate browsers where applicable.

FR-GDR-06 (PENDING): Confirm whether the restriction applies to official company Drive only, all Drive access, or specific files/folders.

### 3.17 WhatsApp and voice-to-text

**FR-WA-01** (MUST): The client shall select the approved WhatsApp integration method and confirm the business account/number and intended message flows.

**FR-WA-02** (SHOULD): Where supported, approved inbound messages may be linked to a user, task, client issue or report item.

**FR-WA-03** (SHOULD): Voice messages may be transcribed to text using an approved transcription service and presented for user review before saving or creating tasks.

**FR-WA-04** (MUST): Automated task creation or sending messages shall require configured permissions and an auditable record.

**FR-WA-05** (MUST): The system shall clearly identify generated transcripts as machine-generated until confirmed by a user.

**FR-WA-06** (MUST): Audio and transcripts shall follow the approved privacy, consent, storage and deletion rules.

**FR-WA-07** (MUST): The system shall handle unsupported audio, poor-quality transcription and integration failures gracefully.

FR-WA-08 (PENDING): Confirm whether WhatsApp is for notifications only, inbound/outbound messaging, voice-note transcription, or all of these.

### 3.18 Android/mobile experience

**FR-MOB-01** (MUST): The web application shall be usable on supported Android screen sizes without horizontal scrolling for core workflows.

**FR-MOB-02** (MUST): Users shall be able to view assigned tasks, update progress, submit reports, upload evidence and review permitted issues from Android.

**FR-MOB-03** (MUST): If Drive access is restricted, Drive controls shall be omitted or blocked on Android according to the approved policy.

**FR-MOB-04** (SHOULD): Draft report data should be recoverable after an accidental navigation or temporary connection interruption, where technically safe.

**FR-MOB-05** (SHOULD): The system should provide accessible tap targets, clear validation messages and upload progress indicators.

### 3.19 Search, exports and audit history

**FR-AUD-01** (MUST): Authorised users shall search reports, tasks and issues by date, department, owner, status and relevant record reference.

Changed v1.2: implemented as the global search panel (§3.22, FR-SRCH-01 to 05), which covers eight record types and respects role access. Per-module list filters also exist.

**FR-AUD-02** (MUST): The system shall record who created, updated, submitted, reviewed, approved, rejected or closed a record and when.

**FR-AUD-03** (MUST): Audit records shall be protected from ordinary users editing or deleting them.

**FR-AUD-04** (SHOULD): Authorised users should export reports to PDF and/or CSV/XLSX subject to access controls.

v1.2 status: the audit log CSV export works (FR-AUD-07) and daily reports export to PDF and Excel (FR-REP-12). Other modules have no export.

**FR-AUD-05** (MUST): Exports shall be logged when they contain sensitive employee, client or payroll data.

### 3.20 Multi-tenancy and SaaS platform (v1.1)

**FR-SAAS-01** (MUST): Every business record (users' memberships, tasks, reports, evidence, issues, files, audit events, settings) shall carry a tenant identifier. The server shall scope every query and file access to the signed-in user's tenant.

**FR-SAAS-02** (MUST): A user from one tenant shall never be able to read, change, search, export or be notified about another tenant's data, including through IDs, URLs, file links, exports, caches or background jobs.

**FR-SAAS-03** (MUST): A new organisation shall be able to sign up and get a working tenant:
- create the organisation and its Tenant Owner account;
- verify email;
- pick a plan or start a trial;
- go through guided setup: departments, timezone, report deadline, report template and inviting users.

Changed v1.2: implemented as a four-step sign-up wizard plus a separate four-step onboarding wizard (§3.29). Email verification and invitations are simulated.

**FR-SAAS-04** (MUST): A tenant shall be seeded with sensible defaults: Security and Cleaning departments, the ten-section daily report template, a 5:30 PM deadline and the standard roles. It can change all of these without platform-operator help.

**FR-SAAS-05** (MUST): Tenant Owners and Tenant Admins shall invite users by email with a role and department. Invitations shall expire and can be revoked.

**FR-SAAS-06** (MUST): The platform shall support subscription plans with limits (for example active users, storage, enabled modules and integrations). It shall enforce those limits on the server and show users clear messages when a limit is reached.

**FR-SAAS-07** (MUST): Subscription billing shall use **Stripe** at launch:
- Stripe Billing for plans, prices and subscriptions.
- Stripe Checkout for sign-up and upgrades.
- The Stripe Customer Portal for card changes, invoices and cancellation.
- Stripe webhooks to sync subscription status.

The platform shall not store card data; Stripe holds it, keeping the platform out of most PCI scope. It shall support trials, upgrades, downgrades, proration, cancellation, invoices/receipts and failed-payment handling (Stripe Smart Retries and dunning) with a grace period.

**FR-SAAS-07a** (MUST): Billing shall sit behind a provider-agnostic billing module. The rest of the system talks only to the platform's own Plan and Subscription records, never to Stripe directly. Adding another payment method or provider later must not require changes to tenant, plan-limit or feature code. Examples of later additions: PayPal, bank transfer/direct debit, a regional gateway, or manual invoicing for enterprise tenants.

Changed v1.2: implemented in the frontend as the `BillingProvider` interface with a mock Stripe implementation (§3.26, FR-BILL-05). Webhooks, idempotency and Integration Events (FR-SAAS-07b) are not built.

**FR-SAAS-07b** (SHOULD): Stripe webhook events shall be verified by signature and processed idempotently. They should also be stored as Integration Events so subscription state can be audited and replayed.

**FR-SAAS-07c** (COULD): Later phases could add payment methods Stripe itself supports, such as SEPA/BACS direct debit and wallets, by enabling them in Stripe. Non-Stripe providers come in through the FR-SAAS-07a adapter.

**FR-SAAS-08** (MUST): If a subscription lapses or a tenant is suspended, the tenant shall become read-only (with export allowed) and not be deleted immediately. Deletion shall follow the published retention period and be confirmed by the Tenant Owner.

**FR-SAAS-09** (MUST): A Platform Super Admin console shall list tenants, plans, subscription status and usage. It shall let staff suspend or reactivate tenants and manage plans, without showing tenant operational data by default.

**FR-SAAS-10** (MUST): Platform support access to a tenant's data shall require the tenant's explicit, time-limited permission. It shall be fully audited and visible to the Tenant Owner.

v1.2 status: implemented as mock UI in two places that are not yet connected: the tenant's grants list in settings (FR-SET-08) and the platform support requests (FR-PLAT-07). No tenant data is viewable.

**FR-SAAS-11** (SHOULD): Tenants should be able to set their name, logo and brand colour. These appear in the app shell, emails and exported reports.

Changed v1.2: name, logo and brand colour are implemented with a live preview (§3.24). The logo shows in the app shell. Branded emails and branded exports are not built.

**FR-SAAS-12** (SHOULD): Each tenant should get its own subdomain (for example `acme.<product-domain>`). A custom domain COULD be offered on higher plans.

**FR-SAAS-13** (SHOULD): A user should be able to belong to more than one tenant with a different role in each, and switch tenant without signing out.

v1.2 status: a tenant switcher exists in the user menu (§3.30), driven by a mock tenant list and a cookie. Real memberships are not modelled.

**FR-SAAS-14** (SHOULD): The platform should track per-tenant usage (active users, storage, messages, transcription minutes) for plan limits, billing and support.

**FR-SAAS-15** (MUST): A Tenant Owner shall be able to export all of the tenant's data in a common format, and request full deletion when leaving.

**FR-SAAS-16** (SHOULD): Integrations such as Google Drive, WhatsApp, email sender and transcription should be connected per tenant, using that tenant's own credentials or a platform account scoped to that tenant. One tenant's tokens shall never be used for another tenant.

### 3.21 Role and module access (v1.2)

Status: implemented in the frontend prototype (mock roles). Code: `lib/permissions.ts`, `lib/session.ts`, `lib/types.ts`, `public/data/shell/roles.json`, `proxy.ts`. Refines §2.3, FR-AUTH-03 and FR-STAFF-03.

**FR-RBAC-01** (MUST): Access shall be defined per role and per module. The modules are: dashboard, tasks, reports, attention, staff (staff and rosters), recruitment, files, payroll, orders, settings, audit and whatsapp. Each role has one access level per module: none, read or write. Write implies read.

**FR-RBAC-02** (MUST): The prototype ships these roles as tenant defaults. Each role also has a "home" that decides the dashboard it lands on (manager home or staff home).

| Role (id) | Home | Module access (modules not listed = none) |
|---|---|---|
| Tenant Owner (`owner`) | Manager | Write on all 12 modules. |
| Tenant Admin (`admin`) | Manager | Write: settings, audit. Read: dashboard, tasks, reports, attention, staff, recruitment, files, orders, whatsapp. No payroll. |
| Designated Manager (`manager`) | Manager | Write: dashboard, tasks, reports, attention, staff, recruitment, files, orders, audit, whatsapp. Read: payroll, settings. |
| Operations Manager / Report Owner (`ops`) | Manager | Write: dashboard, tasks, reports, attention, staff, recruitment, files, orders, whatsapp. Read: settings, audit. No payroll. |
| Department Supervisor / Team Lead (`supervisor`) | Staff | Write: tasks, reports, staff, whatsapp. Read: dashboard. |
| Employee / Staff Member (`employee`) | Staff | Write: tasks. Read: dashboard, reports. |
| HR / Recruitment User (`hr`) | Staff | Write: recruitment, files. Read: dashboard, tasks. |
| Payroll User (`payroll`) | Staff | Write: payroll. Read: dashboard, tasks. |
| Read-only / Auditor (`auditor`) | Manager | Read on all 12 modules. |
| Platform Super Admin (`platform`) | Manager | No tenant module access. Flagged `platform`; lands on the platform console (§3.25). Tenant pages, the dashboard and tasks included, show "Access restricted". |

Changed v1.2: §2.3 gave the roles as "proposed". The matrix above is what the prototype implements. It was filled in by the delivery team for roles the SRS described only by intent (ops, supervisor, employee, hr, payroll, admin), so it still needs client sign-off (OC-10, OC-22). The Tenant Owner and Senior Management rows of §2.3 are merged into `owner`; "Lilianna / Designated Manager" is `manager`. There is no ghost account (FR-AUTH-08 holds).

**FR-RBAC-03** (MUST): A role with no access to a module shall not see that module in navigation. The navigation list is filtered on the server so hidden modules never reach the browser. Opening such a route directly shall show an "access restricted" page, not data.

**FR-RBAC-04** (MUST): A role with read-only access shall see the module's data but every create, edit, approve or delete control shall be disabled or omitted. A tenant whose status is `suspended` shall be read-only for every role (FR-SAAS-08).

**FR-RBAC-05** (MUST): Report review actions (accept, return, comment, follow-up) require a manager-home role with write access to reports. Staff-home roles act as report owners and never review.

**FR-RBAC-06** (MUST): Sensitive fields shall be removed on the server, not hidden in the browser, for roles without write access to the module. Implemented for staff incident and roster contact details and notes (FR-STAFF-03) and candidate contact details (FR-REC-03).

**FR-RBAC-07** (MUST): Staff-home roles shall see only their own tasks and reports, in lists, in task detail (another person's task reference shows "not found") and in global search.

**FR-RBAC-08** (MUST): Signed-out visitors shall be redirected to sign-in before any tenant page renders. Auth pages, the platform console and static files are excluded from that redirect.

Open questions: OC-10, OC-22. Frontend-only: roles are mock JSON and the "current role" is a cookie set by a demo role switcher (§3.30).

### 3.22 Global search and quick actions (v1.2)

Status: implemented (mock data). Route: topbar on every `(app)` page. Code: `features/search/`, `public/data/search/*.json`, `.claude/docs/search/brief.md`. Implements and extends FR-AUD-01.

**FR-SRCH-01** (MUST): A search field in the topbar shall search across record types: task, report, issue (manager-attention item), payroll issue, order, staff incident, candidate and file (client file or employee document). Each result carries id, type, title, reference, link, department, owner, status and date.

**FR-SRCH-02** (MUST): Results shall be filtered by the signed-in role's module read access before they reach the browser. The index is loaded on demand through a server action, never embedded in page payloads. Staff-home roles see only their own tasks and reports.

**FR-SRCH-03** (MUST): Results shall be grouped by type with counts and highlight the matched text. Filters: date range, department, type, owner and status. Active filters show as chips.

**FR-SRCH-04** (SHOULD): The empty state shall show quick actions, the user's recent searches (stored in the browser, up to 6) and popular searches. Quick actions needing write access (for example "New task") appear only for roles with write access to that module.

**FR-SRCH-05** (SHOULD): Keyboard: Cmd/Ctrl+K toggles the panel, `/` opens it when focus is not in an input, arrow keys move through items, Enter opens, Cmd/Ctrl+Enter opens in a new tab, Esc clears then closes, Alt+F opens filters, Backspace on an empty query removes the last filter chip.

Changed v1.2: FR-AUD-01 asked for search by date, department, owner, status and reference. It is implemented as this global search panel rather than per-module search pages; individual list pages also have their own filters (tasks, reports, audit log, files, recruitment, orders, rosters).

Open questions: none new. Search covers eight record types only; clients, WhatsApp messages and audit events are not indexed.

### 3.23 AI assistant (v1.2)

Status: DEMO ONLY. Route: floating button and side panel on every `(app)` page. Code: `features/assistant/`, `public/data/assistant/assistant.json`. Not in the original SRS.

**FR-AI-01** (COULD): A signed-in user can open an assistant panel to ask about tasks, reports, coverage and documents, and to draft reminders. The panel shows a greeting, suggested prompts, a typing indicator and a chat history for the open session.

**FR-AI-02** (COULD): The user can attach up to 4 images (maximum 5 MB each) by picking, pasting or dragging. Invalid files show an error.

**FR-AI-03** (MUST, before any real model is connected): Replies in the prototype are canned keyword matches from mock data and are not generated from live tenant data. A real implementation shall respect tenant isolation (FR-SAAS-02) and the caller's module permissions (FR-RBAC), shall not send data from modules the role cannot read, and shall be treated as an AI feature needing a privacy review (NFR-PRIV-01).

Open questions: OC-23 (provider, data handling, whether it is a paid-plan module). The greeting and replies use `{firstName}`, `{deadline}` and `{tz}` placeholders filled from the signed-in user and org settings (`fillAssistant`), so no tenant values are hard-coded.

### 3.24 Tenant branding (v1.2)

Status: implemented; persistence is a cookie (mock). Route: `/settings/branding`. Code: `features/settings/components/branding-panel.tsx`, `lib/brand.ts`, `lib/branding.ts`, `hooks/use-branding.ts`, `app/actions/session.ts` (`saveBranding`). Refines FR-SAAS-11.

**FR-BRAND-01** (SHOULD): A user with write access to settings can set the tenant display name (2 to 60 characters) and a brand colour (a six-digit hex). Preset colours are tenant data; a colour picker is also offered.

**FR-BRAND-02** (SHOULD): While editing, the app shows a live preview of the new colour across the shell. Leaving the panel without saving restores the saved branding. Saving applies the colour to the whole app for that tenant, in light and dark themes, and updates the initials shown for the tenant.

**FR-BRAND-04** (SHOULD): A user with write access can upload a logo (PNG, JPG, SVG or WebP, up to 512 KB) by click or drag and drop, see it in the live preview, and remove it. The type and size are checked and an inline error is shown. The saved logo shows in the sidebar header, the collapsed rail and the mobile drawer, fitted inside the same box as the default mark on a neutral chip so it works in dark mode. Without a logo the default mark shows. Mock: the file is read in the browser as a data URL and kept in memory (`hooks/use-branding.ts`), so it resets on reload.

**FR-BRAND-03** (MUST): Branding is per tenant and shall never leak between tenants. The save action shall check settings write access on the server and reject invalid input.

Changed v1.2: FR-SAAS-11 listed name, logo and brand colour. Name, colour and logo upload are implemented (logo is in memory only). Emails and exported reports taking the branding are not built. See OC-24.

### 3.25 Platform console (v1.2)

Status: implemented as a frontend prototype; state is in-memory and resets on reload. Routes: `/platform`, `/platform/tenants/[id]`, `/platform/plans`, `/platform/support`. Code: `features/platform/`, `public/data/platform/*.json`. Implements FR-SAAS-09, FR-SAAS-10 and FR-SAAS-14.

**FR-PLAT-01** (MUST): Only the Platform Super Admin role may open the console. Other roles see an "access restricted" page.

**FR-PLAT-02** (MUST): The overview shows platform totals computed from the tenant list and plans (tenant counts by status and monthly recurring revenue from active and past-due tenants) and the platform audit list.

**FR-PLAT-03** (MUST): The tenant list shall show name, subdomain, plan, status (trial, active, past due, suspended), users, storage, messages and transcription minutes. It shall be filterable by text, status and plan.

**FR-PLAT-04** (MUST): The tenant detail page shows contacts, billing summary (payment method, trial end, grace end, renewal, last invoice) and usage against the plan limits (active users, storage in GB, messages, transcription minutes). It shall state that operational data is hidden and requires tenant-granted support access.

**FR-PLAT-05** (MUST): Staff can suspend a tenant (with a reason) or reactivate it, after a confirmation that asks them to type the tenant slug. Suspension sets the tenant read-only for its users (FR-SAAS-08). Suspending and reactivating shall write a platform audit entry.

**FR-PLAT-06** (MUST): Staff can edit an existing plan's price, limits and enabled modules; the change applies to every tenant on that plan and is recorded in the audit trail. Creating or deleting plans is not implemented.

**FR-PLAT-07** (MUST): Support access to tenant data follows a request flow: staff submit a request with a reason; its status is requested, granted, expired or revoked; a granted request has an expiry and shows a countdown; expired state is derived from the clock. Staff can start a support session under a granted request and revoke it; both are audited. Every platform action is recorded in the platform audit list (time, actor, action, target, detail).

Open questions: OC-25. Frontend-only: platform requests and tenant grants are one shared mock list (`lib/support-access.ts`, `public/data/support/requests.json`). A request filed in the platform console shows in the tenant's Settings → Data & privacy, where the Tenant Owner can approve (grant for the tenant's `grantHours`), decline or revoke it; other roles with settings access see the list read-only. The tenant only receives its own rows. Full data export and the deletion request are Owner-only too (FR-SET-08, FR-SAAS-15).

### 3.26 In-tenant billing (v1.2)

Status: implemented with a mock Stripe provider (fake ids and URLs, no network or keys). Route: `/settings/billing`. Code: `features/billing/` (`providers/`), `public/data/billing/*.json`. Implements the tenant-facing side of FR-SAAS-06, FR-SAAS-07 and FR-SAAS-07a.

**FR-BILL-01** (MUST): The billing tab shows the current plan, tenant status, renewal date, price, and the saved card's last four digits when one exists.

**FR-BILL-02** (MUST): Usage is shown against the plan limits for active users, storage, messages and transcription minutes. When a limit is full the tab says so and points to changing plan. The seat limit is also read by the users panel (FR-SAAS-05/06).

**FR-BILL-03** (MUST): The tab lists every plan (price, trial days, limits, enabled modules) and allows "Change plan" (starts provider checkout) and "Manage billing" (opens the provider customer portal).

**FR-BILL-04** (SHOULD): An invoice list shows number, date, amount, status (paid, failed, open) and description, paginated, with a download action per invoice.

**FR-BILL-05** (MUST): The UI shall talk only to a `BillingProvider` interface: create checkout session, open customer portal, cancel subscription, resume subscription, list payment methods. A provider is selected by the tenant billing record's `provider` value. Stripe is the only registered provider. Adding another provider means registering a new implementation; no component changes.

Changed v1.2: FR-SAAS-07a is implemented as the interface in FR-BILL-05. Webhook handling (FR-SAAS-07b), trials/proration/dunning logic and real card handling are NOT implemented in the frontend and remain backend work. The tenant status drives the subscription banner (§3.30) and read-only mode.

Open questions: OC-16, OC-17 (tax), OC-26 (currency: orders format money with the tenant currency and locale from org settings, `lib/money.ts`; the platform's own plan prices are in pounds).

### 3.27 Account page (v1.2)

Status: implemented (mock). Routes: `/account` (redirects to a tab), `/account/profile`, `/account/security`, `/account/notifications`. Code: `features/account/`, `public/data/account/*.json`. Implements FR-AUTH-04, FR-AUTH-05, FR-AUTH-06 and FR-NOT-04 for the signed-in user.

**FR-ACC-01** (MUST): Profile: the user can edit only their display name (length limits come from data). Email, role, department and timezone are shown but come from the session and organisation.

**FR-ACC-02** (SHOULD): Security: turn two-step verification on or off (with confirmation); request a password reset link (the link lifetime is shown); list signed-in devices, marking the current one; sign out one device or all other devices; a recent security activity list. Each action adds an activity entry.

**FR-ACC-03** (SHOULD): Notifications: per user, choose which events notify on which channels, and a lead time for the report-deadline reminder. Channels and events are data driven.

### 3.28 Settings area (v1.2)

Status: implemented (mock, in-memory). Routes: `/settings` redirects to `/settings/[tab]` for `organisation`, `departments`, `users`, `roles`, `template`, `notifications`, `integrations`, `branding`, `billing`, `privacy`. Access: settings module (read to view, write to change). Code: `features/settings/`. Implements FR-ORG-01/02/04, FR-AUTH-02, FR-SAAS-04/05/15 and FR-NOT-04.

**FR-SET-01** (MUST) Organisation: shows tenant name, slug, timezone, report deadline and tenant domain; and sets the weekend rule and session timeout from option lists (FR-AUTH-07).

**FR-SET-02** (MUST) Departments: add, edit, deactivate and reactivate departments, each with sites, teams and a reporting owner.

**FR-SET-03** (MUST) Users and invites: list users (name, email, role, department, status, last active); deactivate and reactivate; send, resend and revoke email invites with a role and department. Invites expire after 7 days. The number of seats is limited by the plan (FR-BILL-02).

**FR-SET-04** (MUST) Roles: a matrix of roles by module where write users change a role's access (none, read, write). Each change shows a confirmation toast saying it is recorded in the audit log.

**FR-SET-05** (SHOULD) Report template: per department, turn the ten sections on or off and see each section's fields and which are required (FR-ORG-04, FR-SAAS-04).

**FR-SET-06** (SHOULD) Notifications: tenant reminder times before the deadline, channels, events per channel, and a switch to hide sensitive details in previews (FR-NOT-04).

v1.2 status: BUILT (mock). Also shows the next reminder time and channels, the mock clock and the delivery log (FR-NOT-02/03/05). Preview text honours the hide-sensitive switch through `preview()` (FR-NOT-04).

**FR-SET-07** (SHOULD) Integrations: one card per integration (Google Drive, WhatsApp Business and others in data) with status (connected, not connected, error), last event and the access policy text; connect and disconnect with confirmation. The WhatsApp card in the seed is "not connected, awaiting client confirmation (OC-05)".

**FR-SET-08** (MUST) Data and privacy: (a) support access: the Tenant Owner can grant platform support time-limited access (default 24 hours), see the list of grants and revoke one (FR-SAAS-10); (b) request a full data export, delivered by emailed link (FR-SAAS-15); (c) request tenant deletion, with a 30-day cancel window (FR-SAAS-08/15).

Changed v1.2: FR-SAAS-15 asks for export and deletion; this is delivered only as these two requests in the privacy tab, with no real file produced.

### 3.29 Sign-up, sign-in and onboarding (v1.2)

Status: implemented (mock; nothing is persisted). Routes: `/sign-in`, `/sign-up`, `/forgot-password`, `/onboarding`. Code: `features/auth/`, `public/data/auth/onboarding-defaults.json`. Implements FR-SAAS-03, FR-SAAS-04, FR-AUTH-01/04/05.

**FR-ONB-01** (MUST): Sign-in is three steps: email and password (minimum 8 characters), a six-digit authenticator code, then "Continue as" a role. In the prototype any six digits pass and the role chooser is a demo aid; a real build replaces it with the user's real memberships.

**FR-ONB-02** (MUST): Sign-up is four steps: Organisation (company name 2 to 80 characters, country, timezone), Owner account (name, email, password meeting listed rules), Verify email, Plan (default plan and trial length come from data; the copy says no card is needed for the trial). The stepper allows moving forward only while earlier steps validate.

**FR-ONB-03** (MUST): Forgot password sends a reset link and shows a neutral message that does not reveal whether the account exists; the link expires after 60 minutes.

**FR-ONB-04** (MUST): First-run onboarding is four steps: Departments, Timezone and deadline, Report template (the ten sections), Invite users. Every step can be revisited. Defaults (departments, deadline, countries, timezones, sections, invite roles) come from tenant-configurable data (FR-SAAS-04, NFR-CONF-01). Finishing signs in as the owner.

Changed v1.2: FR-SAAS-03 listed "verify email, pick a plan or start a trial, guided setup". The prototype splits it into the sign-up wizard and a separate onboarding wizard as above. Email verification and invitations are simulated.

### 3.30 Application shell (v1.2)

Status: implemented. Code: `features/shell/`, `app/(app)/layout.tsx`, `app/(platform)/layout.tsx`, `public/data/shell/*.json`. Supports FR-SAAS-13, FR-NOT-01 and FR-MOB-02.

**FR-SHELL-01** (MUST): The shell has a sidebar (menu and general groups, with optional badges), a topbar with global search (§3.22), the notification bell, the assistant (§3.23), the messages link (opens `/whatsapp`) and a user menu. The sidebar collapses to icons and becomes a drawer on small screens.

**FR-SHELL-02** (MUST): A department switcher in the topbar filters dashboards and lists by department ("All" or one tenant department). When there are more than four departments it becomes a carousel. Departments come from tenant data.

**FR-SHELL-03** (MUST): The notification panel lists notifications with type (assigned, reassigned, deadline, evidence, report returned, manager action, reminder), time, read state and a link to the record (FR-NOT-01).

**FR-SHELL-04** (MUST): A banner shows above every page for tenants in trial (trial end date, link to choose a plan), past due (grace date, link to billing) and suspended (read-only notice, export still allowed) (FR-SAAS-08).

**FR-SHELL-05** (SHOULD): The user menu offers tenant switching for users with more than one tenant (FR-SAAS-13), role switching (demo only), a link to the account page and sign-out. Switching tenant or role refreshes the session and navigation.

**FR-SHELL-06** (SHOULD): A card in the sidebar offers installing the app on Android ("Take OpsDesk on site"); it is hidden when the sidebar is collapsed (FR-MOB-01/02).

**FR-SHELL-07** (MUST): Every page and component has a loading skeleton that matches its final layout, and the interface supports light and dark themes with the tenant brand colour (§3.24).

**FR-SHELL-08** (MUST): Footer note for the prototype: "Prototype for client review · sample data · all times shown in London time (GMT)". This is prototype copy, not a product requirement; times shall be shown in the tenant timezone (§5.2).

### 3.31 Implementation notes for operations modules (v1.2)

These add to the existing sections. Unless stated, the data is mock JSON and edits live in an in-memory per-feature store that resets on reload (`lib/store.ts`).

Tasks (`/tasks`, `/tasks/[ref]`, `features/tasks/`), extends §3.3:
- **FR-TASK-13** (v1.2): The task list filters by status, due date, priority (1 to 3), assignee and text, is paginated, and a `?new=1` link opens the create dialog. Task references look like TSK-1001 and are unique within a tenant. The detail page shows notes, evidence, timeline and any overdue record.
- **FR-TASK-14** (v1.2): Evidence kinds are image, file, link and note. Review outcomes are pending, accepted, rejected and information requested; a reason is kept for rejections and information requests.
- **FR-TASK-15** (v1.2): Tags are stored per task. A task can carry a repeat rule (`repeat`: daily, weekdays, weekly on chosen days, or monthly on day N, with an optional end date). `materialiseRecurring` adds a new Not Started copy (`seriesId` = the series task's ref) for each occurrence date up to the org's today, once per series and date, so running it again adds nothing. A day-of-month rule that does not exist in a month (for example 31) uses that month's last day. The task list shows a repeat badge and has a Recurring filter; the detail page shows the rule and managers can change it. Task templates (title, description, department, optional assignee, priority, tags, evidence flag, due offset in days and time) are listed in the New task dialog under "Use template"; managers with write access can save the form as a template and delete templates. Templates are held in memory only. Dependencies (FR-TASK-10) are NOT implemented.

Daily reports (`/daily-reports`, `/daily-reports/[id]`, `features/reports/`), extends §3.4, §3.5, §4:
- **FR-REP-15** (v1.2): The list page has today's report card, a submission board by department and owner, a review queue, and a history filtered by date range, owner and status. History export writes the filtered rows to PDF or Excel (FR-REP-12).
- **FR-REP-16** (v1.2): The template comes from tenant data (sections, fields, entry type text, count or structured, required flags). A section can be marked restricted (the payroll section). Each field supports a state (no issues, action required, not applicable, details provided) and multiple entries.
- **FR-REP-17** (v1.2): Each report carries a version history, comments (optionally tied to a section), and the original submission time never changes on resubmission. Only the report owner edits a draft or returned report; managers review. Nil reports are explicit.

Manager attention (`/manager-attention`, `features/attention/`), extends §3.5, §3.14:
- **FR-REV-07** (v1.2): An attention item has title, summary, impact, urgency (low, medium, high, critical), requested decision, owner, due date, department, source (report, task, client, staff, roster, stock), status (awaiting decision, decided, in progress, resolved) and a history. Deciding records outcome (approved, rejected, deferred), a required note, decision maker and time. A deferred item stays open.
- **FR-OUT-06** (v1.2): The page also lists outstanding items (reason, owner, priority 1 to 3, next action, target date, date first carried forward). Closing one needs a resolution note (FR-OUT-05).

Staff and rosters (`/staff-rosters`, `features/staff-rosters/`), extends §3.6, §3.8:
- **FR-STAFF-05** (v1.2): Attendance incidents have type (call-out, no-show, cover, staff issue), staff member, shift, site, client, cover person, owner, action, status (open, covered, escalated, resolved) and history. Roster gaps have when (today, tomorrow, next week), shift time, site, client, role, assigned person, coverage (covered, partial, uncovered), owner and next action. Dialogs exist to log an incident, arrange cover and log a gap. Contact details and notes are removed on the server for roles without staff write access (FR-RBAC-06).

Recruitment (`/recruitment`, `features/recruitment/`), extends §3.9:
- **FR-REC-05** (v1.2): Candidates move through stages applied, reviewed, contacted, interview, offer, starter and rejected, in a kanban pipeline (drag and drop) or a list. Every stage change is recorded in the candidate's history. Candidate email and phone are removed on the server for roles without recruitment write access (FR-REC-03).

Files (`/files`, `features/files/`), extends §3.10, §3.11:
- **FR-EFILE-06** (v1.2): Employee documents have status valid, expiring, expired, missing or unverified. Confirming a document sets its status from its expiry date and records who confirmed it (FR-EFILE-05). Opening a secure link is logged. Client files list contacts, contract reference, document status (complete, incomplete, review), outstanding paperwork and an access history.

Payroll issues (`/payroll-issues`, `features/payroll/`), extends §3.12:
- **FR-PAY-05** (v1.2): Issue types are missed hours, overtime, deduction, bank details and other. Statuses are open, information needed, correction required and resolved; resolving requires a resolution note. References look like PAY-1001. Write access is limited to the payroll role and the Tenant Owner; the Designated Manager has read access only (FR-RBAC-02).

Orders and stock (`/orders-stock`, `features/orders/`), extends §3.13:
- **FR-STOCK-05** (v1.2): Tabs: waiting approval, orders, deliveries. An order has reference (ORD-n), item, quantity, supplier, requester, department, amount, approval (pending, approved, rejected), delivery (not ordered, ordered, partial, delivered), expected date and history. Rejection requires a reason. An order can be marked ordered only after approval. Deliveries may be partial; receiving more than the remaining quantity is refused.

Audit log (`/audit-log`, `features/audit/`), extends §3.19:
- **FR-AUD-06** (v1.2): Each event shows time, actor and role, action, record type and reference, IP, device, a sensitive flag and expandable metadata. Action types: sign-in, failed sign-in, role change, deactivation, export, status change, report submitted, reviewed, returned, decision, invite and billing. Filters: text, actor, action, record type and date range.
- **FR-AUD-07** (v1.2): "Export CSV" downloads the filtered rows and appends an export event (actor, row count, file name) to the log (FR-AUD-05).

WhatsApp inbox (`/whatsapp`, `features/whatsapp/`, doc `.claude/docs/features/whatsapp.md`), extends §3.17:
- **FR-WA-09** (v1.2): An in-app inbox with a conversation list (filters All, Unread, Linked, Unlinked, Voice), a thread and a context panel. An integration card shows provider, method, business number, status (pending, connected, disconnected), last sync, an error with reconnect when disconnected, the privacy and consent rules, and one tile per flow (alerts, inbound, outbound, task creation, voice), each enabled or pending.
- **FR-WA-10** (v1.2): Messages can be linked to a user, task, issue or report. Voice notes show a transcript marked machine-generated until a user confirms it (FR-WA-05); a confidence value below a threshold shows a quality warning; transcripts can be edited, and failed or unsupported audio is shown with a reason (FR-WA-07).
- **FR-WA-11** (v1.2): Sending needs the outbound flow enabled and a connected integration; task creation needs the task-creation flow and write access to tasks; confirming transcripts needs the voice flow; read-only roles and suspended tenants cannot send, link, create or confirm. Every link, task creation and transcript confirmation adds an event in the thread (FR-WA-04).
- All of this is mock data. Which flows are enabled and the provider are open (FR-WA-01, FR-WA-08, OC-05). Tasks created from a message are handed to the tasks list through `lib/task-inbox.ts` and appear in /tasks (merged when a tasks screen mounts, only into the same tenant; staff only see their own).

Dashboards (`/`, `features/dashboard/`), extends §10.1, §10.2:
- **FR-DASH-01** (v1.2): Manager-home roles see the manager dashboard: summary cards, tasks-closed chart, daily-report deadline with countdown and reminders, manager-attention list with a Decide dialog, task progress, team tasks table, and coverage and files. Staff-home roles see the staff dashboard: my tasks, evidence awaiting review, today's report, recent manager comments and stats. Quick actions (new task, start daily report, remind, view queue, decide) show only for roles with the needed write access. The report deadline and reminder times come from tenant data.

## 4. Daily Report Template and Field Requirements

The following is the proposed digital equivalent of the client's supplied report. The wording should be preserved unless the client approves changes.

| **Section** | **Fields to capture** | **Suggested behaviour** |
|---|---|---|
| Header | Report date; department (Security/Cleaning); report owner; status; submission timestamp | Date defaults to today; report owner auto-populated; deadline shown as 5:30 PM in confirmed timezone. |
| 1. Staff / Attendance | Call-outs; No-shows; Cover arranged; Outstanding staff issues | Allow multiple entries, staff/shift reference, notes, owner and action. |
| 2. Client Issues | Client contacted; Complaints; Requests; Outstanding issues | Allow client/site, contact method, details, urgency and follow-up. |
| 3. Rosters | Today's issues; Tomorrow's cover; Next week's gaps | Allow shift/date/site, coverage status, assigned owner and next action. |
| 4. Recruitment | Applications reviewed; Candidates contacted; Interviews arranged; New starters; Outstanding candidates | Allow counts and/or individual candidate references; define preferred approach with client. |
| 5. Employee Files | Files updated; Documents received; Missing documents; Expiring licences/documents | Allow document type, staff reference, expiry date and secure attachment/reference. |
| 6. Client Files | Files updated; Contracts; Contact details; Outstanding paperwork | Allow client/site and contract/document reference. |
| 7. Payroll | Issues identified; Corrections required; Outstanding information | Restricted access; issue-tracking only unless payroll processing is approved. |
| 8. Orders / Stock | Orders placed; Deliveries received; Items required; Waiting for approval | Allow item, quantity, supplier/reference and approval state. |
| 9. Outstanding | Tasks not completed today; Reason; Action required | Link to task/issue when possible; require owner and target date for actionable items. |
| 10. Manager Attention Required | Anything needing Lilianna's decision/action | Require summary, decision requested, urgency, owner and status where applicable. |

### 4.1 Field behaviour

- Free-text fields should support concise notes and multiple line entries.
- Where structured records exist, users should link the record instead of duplicating sensitive details.
- For each section, the user should be able to indicate no issues or not applicable where appropriate.
- The report must not require unnecessary personal data. Use record references and links where practical.
- The form should show a progress indicator and identify sections needing attention before submission.

### 4.2 Report lifecycle

| **Status** | **Meaning** | **Permitted next states** |
|---|---|---|
| Draft | Saved but not submitted | Draft, Submitted |
| Submitted | Submitted by report owner; awaiting review | Reviewed, Returned for Correction |
| Returned for Correction | Reviewer requested changes | Draft/Resubmitted |
| Resubmitted | Updated report submitted again | Reviewed, Returned for Correction |
| Reviewed | Reviewer completed review | Reviewed; amendment workflow if changes are needed |
| Overdue | Not submitted by configured deadline | Submitted late; overdue remains in audit history |

## 5. User Interface Requirements

### 5.1 Main screens

| **Screen** | **Main content/actions** |
|---|---|
| Sign-in | Secure sign-in, account recovery, MFA if configured. |
| Role-based dashboard | My tasks, due/overdue items, report deadline, alerts, quick actions. |
| Task list/detail | Filters, assignment, status, timeline, notes, evidence, review history. |
| Daily report form | Ten report sections, save draft, validation, submit, attach evidence. |
| Management report dashboard | Submission status, report review queue, department/date filters, overdue reports. |
| Manager attention queue | Items requiring decisions, urgency, owner, due date, decision and resolution history. |
| Staff/roster view | Staff incidents, coverage gaps and actions, limited by role. |
| Recruitment view | Candidate stages and outstanding actions, limited by role. |
| Employee/client file views | Secure metadata and document references with access control. |
| Payroll issue view | Restricted issue list and corrections required. |
| Orders/stock view | Orders, deliveries, items required and approvals. |
| Audit/settings | Users, roles, departments, deadline/timezone, notification settings and integration status. |

### 5.2 Usability principles

- Use plain language and avoid technical terms in the employee-facing interface.
- Use consistent status labels and do not rely on colour alone to communicate status.
- Keep the daily report form easy to use on mobile, with collapsible sections if needed.
- Provide clear error messages that explain how to fix a validation issue.
- Confirm destructive actions such as cancelling tasks or removing records.
- Show timezone next to all deadlines and timestamps.

### 5.3 Route map (v1.2)

All routes are Next.js App Router pages. `(app)` routes need a signed-in session and module access (§3.21). Each has a `loading.tsx` skeleton.

| Route | Screen | Module | Feature folder |
|---|---|---|---|
| `/` | Role-based dashboard (manager or staff) | dashboard | `features/dashboard` |
| `/tasks`, `/tasks/[ref]` | Task list and detail | tasks | `features/tasks` |
| `/daily-reports`, `/daily-reports/[id]` | Daily reports, board, queue, history, report form and review | reports | `features/reports` |
| `/manager-attention` | Attention queue and outstanding items | attention | `features/attention` |
| `/staff-rosters` | Attendance incidents and roster gaps | staff | `features/staff-rosters` |
| `/recruitment` | Candidate pipeline and list | recruitment | `features/recruitment` |
| `/files` | Employee documents and client files | files | `features/files` |
| `/payroll-issues` | Payroll issue tracker | payroll | `features/payroll` |
| `/orders-stock` | Orders, approvals, deliveries | orders | `features/orders` |
| `/whatsapp` | WhatsApp inbox and integration card | whatsapp | `features/whatsapp` |
| `/audit-log` | Audit history and CSV export | audit | `features/audit` |
| `/settings`, `/settings/[tab]` | Settings (10 tabs; billing tab uses `features/billing`) | settings | `features/settings`, `features/billing` |
| `/account`, `/account/[tab]` | Own profile, security, notifications | any signed-in role | `features/account` |
| `/sign-in`, `/sign-up`, `/forgot-password`, `/onboarding` | Auth and onboarding | public | `features/auth` |
| `/platform`, `/platform/tenants/[id]`, `/platform/plans`, `/platform/support` | Platform console | platform role | `features/platform` |
| (topbar, all `(app)` pages) | Global search, assistant, shell | n/a | `features/search`, `features/assistant`, `features/shell` |

## 6. Data Requirements and Conceptual Model

### 6.1 Core entities

| **Entity** | **Key fields (indicative)** | **Relationships** |
|---|---|---|
| Tenant (v1.1) | id, name, slug/subdomain, status (trial/active/past-due/suspended/closed), timezone, branding, settings | Owns every tenant-scoped record below. |
| Plan / Subscription (v1.1) | plan id, limits, price; tenant id, status, period, provider customer/subscription ref | One active subscription per tenant. |
| Membership / Invitation (v1.1) | user id, tenant id, role, department; invite email, token hash, expiry | Links a user to one or more tenants. |
| User | id, name, email/login, active status, role, department/team | Assigned tasks; owns reports; submits evidence; audit actor. |
| Role / Permission | role id, permission keys, scope | Assigned to users; controls records/actions. |
| Department / Site | id, name, type, active status | Owns tasks, reports, roster items and client operations. |
| Task | id, title, description, owner, creator, department, priority, status, due date, completion date, repeat rule, series id | May link to report, client, roster, evidence and issue. |
| Evidence | id, task/report/issue reference, file/link, uploader, timestamp, review status | Belongs to a parent record; access inherits restrictions. |
| Daily Report | id, date, department, owner, status, submission timestamp, version | Contains section entries and linked tasks/issues. |
| Report Entry | id, report id, section, field, text/structured value, status | Belongs to one report; may link to a task or issue. |
| Issue / Action | id, type, summary, priority, owner, next action, due date, status, resolution | Can originate from report, task, client, staff, roster or stock. |
| Staff Record | id/reference, approved staff details, active status | Links to attendance incidents, roster and document metadata. |
| Candidate | id/reference, contact details, recruitment stage, next action, owner | Access limited to recruitment-authorised roles. |
| Document Metadata | id, subject reference, type, received date, expiry date, storage reference, status | May relate to staff or client; file access controlled. |
| Client / Site | id, business name, site, approved contacts, status | Links to client issues, contracts, rosters and tasks. |
| Payroll Issue | id, reference, issue type, description, owner, status, resolution | Restricted module; not a payroll engine. |
| Stock / Order Item | id, item, quantity, supplier/reference, approval, delivery status | May link to report and approver. |
| Audit Event | id, actor, action, record type/id, timestamp, metadata | Append-only or tamper-resistant audit history. |
| Integration Event | id, provider, event type, status, timestamp, error reference | Tracks WhatsApp, Drive and transcription events without logging secrets. |

### 6.2 Data integrity rules

- Every business record shall have a unique identifier.
- (v1.1) Every tenant-scoped record shall have a non-null tenant id. Uniqueness rules (for example task references like TSK-1031) apply within a tenant.
- Timestamps shall be stored consistently (preferably UTC) and displayed in the configured business timezone.
- A submitted report shall retain its submission time and version history.
- Records referenced by historical reports should not be hard-deleted without an approved retention/legal process.
- Sensitive files should use private storage and short-lived authorised access links where applicable.
- Integration credentials, tokens and secrets shall never be stored in plain text or exposed to the browser.

### 6.3 Retention and deletion

Retention periods for reports, employee documents, candidate data, client files, payroll issue records, audio and transcripts are not provided by the client. The client must approve a retention schedule and any legal/compliance requirements before production use. The system shall support controlled deletion/anonymisation where required and retain audit records according to the approved policy.

### 6.4 Additional entities in the prototype (v1.2)

Indicative shapes taken from `features/<feature>/types.ts`. The §6.1 entities still apply.

| **Entity** | **Key fields** | **Notes** |
|---|---|---|
| Role (access matrix) | id, label, home (manager or staff), access per module (none, read, write), platform flag | Mock `shell/roles.json`. |
| Tenant (session) | id, name, slug, initials, brand colour, status (trial, active, past_due, suspended), plan, trialEndsOn, graceEndsOn | Branding overrides held in a per-tenant cookie. |
| Platform tenant | tenant fields plus subdomain, users, storageGb, messages, transcriptionMinutes, contacts, billing summary, suspendedAt, suspendReason | `platform/tenants.json`. |
| Plan | id, name, priceMonthly, currency, trialDays, limits (activeUsers, storageGb, messages, transcriptionMinutes), modules | `billing/plans.json`. |
| Invoice | id, number, date, amount, currency, status (paid, failed, open), description | `billing/invoices.json`. |
| Support request | id, tenantId, requester, reason, status (requested, granted, expired, revoked), requestedAt, expiresAt, grantedBy | Platform side. |
| Support grant | id, who, reason, grantedAt, expiresAt | Tenant side (privacy tab). |
| Platform audit entry | id, at, actor, action, target, detail | |
| Search item | id, type, title, ref, href, dept, owner, status, date | Built per request, role filtered. |
| Notification | id, type, title, at, read, href | Seven types (§3.30). |
| Attention item / Outstanding item | see FR-REV-07, FR-OUT-06 | |
| Incident / Roster gap | see FR-STAFF-05 | |
| Candidate | id, name, role, dept, stage, contact (restricted), lastContact, nextAction, owner, applied, history | |
| Employee document / Client file | see FR-EFILE-06 | storageRef instead of a file in the prototype. |
| Order | ref, item, qty, supplier, requester, dept, approval, delivery, expected, amount, received, rejectReason, history | Amount in the tenant currency (org `currency`/`locale`, OC-26). |
| Payroll issue | ref, staff, dept, type, description, owner, target, status, resolution, history | |
| WhatsApp conversation, message, transcript, integration | see FR-WA-09 to 11 and `features/whatsapp/types.ts` | |
| Audit event | id, at, actor, actorRole, action, recordType, recordRef, ip, device, sensitive, meta | |
| Device session / security state | id, device, kind, location, lastActive, current; mfa flag | Account page. |

## 7. Non-Functional Requirements

NFR-SEC-01: Enforce least-privilege access and server-side authorisation for all protected records and operations.

NFR-SEC-02: Use HTTPS for all application traffic and encrypt sensitive data at rest using the selected hosting/storage provider's supported controls.

NFR-SEC-03: Protect against common web application risks, including injection, cross-site scripting, cross-site request forgery, insecure direct object references and unsafe file uploads.

NFR-SEC-04: Apply secure session management, rate limiting for authentication, secret management and dependency/security updates.

NFR-SEC-05: Sensitive actions and data access shall be logged without recording passwords, tokens or unnecessary personal data.

NFR-PRIV-01: Collect only data necessary for the stated workflows and show appropriate notices for audio transcription and any monitoring-related feature.

NFR-PRIV-02: Do not build covert audio recording, keylogging, or hidden employee surveillance. Any activity monitoring must be transparent, proportionate, authorised and legally reviewed.

NFR-AVAIL-01: Target monthly availability and support hours shall be agreed before launch; an initial target of 99.5% monthly availability may be considered but is not yet a contractual commitment.

NFR-PERF-01: Under the agreed expected load, common dashboard and task actions should normally respond within 3 seconds at the 95th percentile, excluding third-party API delays and large file uploads.

NFR-PERF-02: The application shall display progress for long-running exports, uploads or transcription jobs.

NFR-SCALE-01: Architecture shall support adding users, departments, report history and evidence without a redesign of the core data model.

NFR-REC-01: Backups shall be automated at an agreed frequency and restore procedures tested before production release.

NFR-REC-02: Recovery point objective (RPO) and recovery time objective (RTO) shall be agreed with the client.

NFR-USE-01: Core workflows shall be responsive on desktop and Android and usable without horizontal scrolling at supported viewport sizes.

NFR-ACCESS-01: Use accessible labels, keyboard navigation, readable contrast, clear focus states and non-colour-only status indicators.

NFR-COMP-01: The system shall use a documented supported browser/device matrix agreed during UAT.

NFR-MAINT-01: Application configuration, report sections and deadline settings should be changeable without code changes where practical.

NFR-OBS-01: Errors and integration failures shall be logged with a trace/reference ID and surfaced to authorised support users without leaking secrets.

NFR-PORT-01: Client data should be exportable in a common format subject to role permissions and the agreed data-processing arrangement.

NFR-TEN-01 (v1.1): Tenant isolation shall be enforced at the data layer (for example database row-level security or a mandatory tenant filter in the data-access layer), not only in UI or route code. Automated tests shall prove that cross-tenant access fails.

NFR-TEN-02 (v1.1): One tenant's load shall not degrade others. Apply per-tenant rate limits and quotas for API calls, uploads, exports and background jobs.

NFR-TEN-03 (v1.1): Backups shall allow restoring a single tenant's data without rolling back other tenants.

NFR-SCALE-02 (v1.1): The architecture shall support onboarding new tenants without code changes or manual deployments.

NFR-CONF-01 (v1.1): Tenant-specific behaviour (departments, deadline, timezone, report template, reminders, branding, enabled modules) shall be configuration, never hard-coded.

NFR-LEGAL-01 (v1.1): The platform shall publish Terms of Service, a Privacy Policy and a Data Processing Agreement. The platform operator acts as processor for tenant data. The hosting data region(s) shall be documented.

## 8. Security, Privacy and Governance

- Define a role/permission matrix and obtain client sign-off before implementation.
- Apply stricter access controls to payroll issues, employee documents, candidate data, client contracts and any audio/transcript content.
- Document the purpose and behaviour of any special administrator or test account. No covert 'ghost' account should be deployed.
- Agree whether screenshots/evidence may contain personal or client-confidential information and provide handling rules.
- Agree privacy notices, lawful basis/consent where applicable, access requests, retention, deletion and incident-response process with the client's responsible adviser.
- Use an approved integration account and least-privilege scopes for Google services.
- Ensure WhatsApp integration uses an approved business account/provider and complies with applicable platform policies.
- Separate development, staging and production environments; use synthetic data for testing wherever possible.
- Ensure audit logs are accessible only to authorised personnel and protected from ordinary editing/deletion.

## 9. Integration Requirements

| **Integration** | **Purpose** | **Requirements / dependencies** | **Open decision** |
|---|---|---|---|
| Google Drive / Google Workspace | Access or link approved company files from allocated PC | OAuth/Workspace policies, least privilege, device/access enforcement, secure link handling | Define what is accessible, on which PC(s), and what must be blocked on Android. |
| WhatsApp | Messaging, task/report updates and/or notifications | WhatsApp Business Platform or approved provider, business number, templates/permissions, provider fees and API limits | Choose exact inbound/outbound flows and account type. |
| Voice-to-text | Convert voice messages to reviewable text | Approved transcription service, supported languages, audio limits, privacy/retention controls | Confirm supported languages, auto/manual trigger, and whether audio is retained. |
| Email/in-app notifications | Reminders and workflow alerts | SMTP or transactional email provider; push/in-app implementation | Confirm channels, sender, timing and escalation rules. |
| File storage | Evidence and document storage | Private object storage or approved managed storage; malware scanning; signed URLs | Choose hosting/storage provider and data region if required. |

## 10. Reporting and Dashboard Requirements

### 10.1 Employee dashboard

- My open tasks and due dates
- Tasks overdue or blocked
- Evidence awaiting review / returned for correction
- Today's report status and deadline
- My recent submissions and manager comments

### 10.2 Manager dashboard

- Daily report status by department and owner
- Submitted, pending, overdue, returned and reviewed reports
- Task completion/on-time/late summary
- Open issues grouped by urgency, owner and age
- Roster gaps and tomorrow's cover
- Documents approaching expiry, where permitted
- Manager Attention Required queue
- Recent decisions and unresolved actions

### 10.3 Report outputs

- View report in browser
- Print or export an approved report
- Filter historical reports by date, department, owner and status
- Export permissions and audit logging for sensitive data
- Display generated timestamp and report version on exported documents

## 11. Business Rules

- BR-01: A daily report is due at 5:30 PM in the client-approved timezone.
- BR-02: The system must record actual submission time; late submission must be identifiable without changing the original timestamp.
- BR-03: Report owner, department and report date are mandatory.
- BR-04: A report may be submitted as a nil/clear report, but the user must explicitly indicate that state.
- BR-05: A task that requires evidence cannot be marked approved/completed until required evidence is reviewed or an authorised exception is recorded.
- BR-06: Overdue tasks require a reason and next action when they are included as an outstanding item, subject to client-approved validation rules.
- BR-07: Every manager-attention item must have a recorded status; actionable items should have an owner and due date.
- BR-08: Changes to submitted reports and important tasks must be auditable.
- BR-09: Access to sensitive data follows role and department permissions, not merely the user's device.
- BR-10: A Google Drive restriction must be enforced by an appropriate access-control mechanism, not just by hiding a UI element.
- BR-11: WhatsApp-generated transcripts are drafts until reviewed/confirmed according to the configured workflow.
- BR-12: The definition and permissions of a ghost account must be approved before development; covert or unaudited access is prohibited.

## 12. Acceptance Criteria and User Acceptance Testing

| **ID** | **Acceptance test** | **Expected result** |
|---|---|---|
| UAT-01 | Sign in as an employee and open dashboard | Only permitted tasks, reports and records are visible. |
| UAT-02 | Manager creates and assigns a task with a deadline | Assignee receives the task; creator, owner and deadline are stored. |
| UAT-03 | Employee submits a task with required evidence | Evidence is attached and task moves to review state. |
| UAT-04 | Reviewer rejects evidence with a reason | Task returns for correction and reason is visible to authorised assignee. |
| UAT-05 | Complete a daily report with all ten sections | The report saves and can be submitted after validation. |
| UAT-06 | Submit a report before the deadline | Submission timestamp and submitted status are recorded. |
| UAT-07 | Leave a required report field incomplete | The system explains what must be completed; it does not silently submit. |
| UAT-08 | Do not submit by the configured deadline | Dashboard flags the report overdue and sends configured alert(s). |
| UAT-09 | Record an issue requiring Lilianna's decision | It appears in the Manager Attention queue with the requested decision. |
| UAT-10 | Resolve an outstanding issue | Resolution note, owner and timestamp are preserved. |
| UAT-11 | Try to access payroll or employee documents as an unauthorised role | Access is denied server-side and the event is logged where appropriate. |
| UAT-12 | Access Google Drive from a prohibited Android context | Access is blocked by the approved policy, including direct-link/session tests. |
| UAT-13 | Process an approved WhatsApp voice note | Transcript is generated if supported, identified as machine-generated and reviewable before use. |
| UAT-14 | Review historical report after an amendment | Original submission timestamp and amendment history remain available. |
| UAT-15 | Use core workflows on supported Android device | Tasks, report submission, comments and evidence upload work at supported screen sizes. |
| UAT-16 | Export a report as an authorised user | Export matches permitted data, includes report date/version and follows access/audit policy. |

### 12.1 Definition of done

- All MUST requirements in the agreed release are implemented and tested.
- No unresolved critical/high security defects remain at production approval.
- Role/permission tests pass for each agreed role.
- The daily report fields match the client-approved template.
- Backup and restore procedures are documented and tested.
- Client UAT is completed and sign-off recorded.
- Admin/user guidance and support handover are delivered.

## 13. Recommended Delivery Phases

| **Phase** | **Scope** | **Exit criteria** |
|---|---|---|
| Phase 0 – Discovery & sign-off | Confirm ambiguous requirements, role matrix, timezone, integrations, retention, hosting and report ownership. | Approved SRS and acceptance criteria. |
| Phase 1 – Core MVP | (v1.1) Multi-tenant foundation (tenant id everywhere, isolation tests, sign-up and onboarding, invitations). Authentication, roles, departments, task management, evidence, daily report form, report review, outstanding actions, manager dashboard, audit trail. | Core UAT passed. |
| Phase 2 – Operations modules | Staff/attendance, roster gaps, recruitment tracker, employee/client document metadata, payroll issue tracker, orders/stock approvals. | Module UAT passed; permissions validated. |
| Phase 3 – Integrations & mobile refinement | Google Drive access policy/integration, WhatsApp Business integration, voice-to-text, notifications, Android optimisation. | Integration/security tests and UAT passed. |
| Phase 3b – SaaS commercial (v1.1) | Plans and limits, Stripe billing (Checkout, Customer Portal, webhooks) behind the provider-agnostic billing module, trials, platform admin console, branding, subdomains, tenant export/deletion, legal pages. | Billing tested end-to-end in provider test mode; isolation and penetration tests passed. |
| Phase 4 – Production launch | Data setup, training, backups, monitoring, support process and launch. | Client approval and operational handover. |

## 14. Risks and Mitigations

| **Risk** | **Impact** | **Mitigation** |
|---|---|---|
| Ambiguous ghost account request | Security/privacy risk and scope uncertainty | Do not implement until purpose and audit requirements are explicitly approved. |
| Google Drive PC-only access is misunderstood | Potential data leakage or unusable access | Use managed identity/device controls and test direct links/sessions; confirm exact policy. |
| WhatsApp integration constraints | Unexpected cost or unavailable personal-account automation | Confirm business account, provider, message flow, fees and policy before estimating. |
| Voice transcription errors | Incorrect tasks or operational records | Show transcript as unconfirmed draft and require user review for consequential actions. |
| Report ownership unclear | Duplicate or missing reports | Confirm whether reports are per person, per department or consolidated. |
| Sensitive employee/payroll data exposed | Privacy and compliance incident | Strict RBAC, audit logs, least privilege, retention controls and security testing. |
| Scope creep | Cost/time overrun | Use approved change requests and phase optional features. |
| Poor mobile connectivity | Lost updates or duplicate submissions | Use draft persistence, retry handling and clear submission confirmation where feasible. |
| Cross-tenant data leak (v1.1) | Severe breach affecting several customers | Data-layer isolation, automated cross-tenant tests, tenant-scoped storage paths and caches, and security review before launch. |
| Launch-client specifics hard-coded (v1.1) | Product can't be sold to other companies | Treat all client-specific values as tenant settings (NFR-CONF-01). |
| Billing failures or disputes (v1.1) | Revenue loss, wrongful lockout | Use the provider's dunning flow, a grace period, and read-only rather than deletion (FR-SAAS-08). |

## 15. Open Questions / Pending Client Confirmation

| **ID** | **Question** | **Why it matters** | **Owner/status** |
|---|---|---|---|
| OC-01 | Who submits the EOD report: one report owner, each employee, or both? | Determines workflow and dashboard model. | Client – Pending |
| OC-02 | Which timezone defines 5:30 PM? Which days require reports? | Deadline, reminders and overdue logic. | Client – Pending |
| OC-03 | What exactly is a 'ghost account'? | Authentication, permissions, audit and privacy. | Client – Pending |
| OC-04 | What is the exact Google Drive policy and allocated-PC definition? | Controls and integration architecture. | Client/IT – Pending |
| OC-05 | What WhatsApp flows are required: alerts, inbound messages, outbound replies, task creation, voice transcription? | Provider, cost and API design. | Client – Pending |
| OC-06 | Which languages must voice-to-text support? Should audio be stored or deleted after transcription? | Provider choice, accuracy and privacy. | Client – Pending |
| OC-07 | What evidence is required for which task types? | Task validation and reviewer workflow. | Client – Pending |
| OC-08 | Can Lilianna approve the whole report, individual issues, or both? | Approval states and permissions. | Client – Pending |
| OC-09 | Should Security and Cleaning have separate reports or one report with department sections? | Data model and dashboard filters. | Client – Pending |
| OC-10 | What are the user roles, staff count and expected concurrent usage? | Permissions, sizing and testing. | Client – Pending |
| OC-11 | Are existing task, roster, recruitment, payroll, client or stock tools in use? | Potential integrations and migration scope. | Client – Pending |
| OC-12 | What data retention periods, hosting/data region and privacy rules apply? | Storage, compliance and operating cost. | Client – Pending |
| OC-13 | Are PDF/Excel exports required? Who may export sensitive data? | Reporting implementation and permissions. | Client – Pending |
| OC-14 | What reminder schedule should be used before/after 5:30 PM? | Notification rules. | Client – Pending. The offsets (before) and overdue checkpoints (after) are data in `settings/notifications.json`, so the answer is a data change, not code. |
| OC-15 | Is the expected product a responsive web app/PWA or a native Android app? | Delivery estimate and platform scope. | Client – Proposed web app; confirm |
| OC-16 (v1.1) | Pricing model: per user, per site, or flat tiers? Is there a free trial, and how long? | Plan limits and billing design. | Product owner – Pending |
| OC-17 (v1.1) | Payment provider: **Stripe** for now; other methods may be added later (FR-SAAS-07a). Still open: currencies, and VAT/tax handling (Stripe Tax or manual). | Billing integration and tax. | Product owner – Provider decided (Stripe); tax pending |
| OC-18 (v1.1) | Self-serve sign-up, or sales-led onboarding only? | Onboarding flow and platform admin tooling. | Product owner – Pending |
| OC-19 (v1.1) | Isolation model: shared database with row-level security, schema per tenant, or database per tenant? | Cost, scaling and compliance. | Tech lead – Pending |
| OC-20 (v1.1) | Hosting data region(s); do some tenants need a specific region? | Compliance (for example UK/EU GDPR) and infrastructure. | Product owner – Pending |
| OC-21 (v1.1) | Subdomains and custom domains: on which plans? | Routing, TLS and branding. | Product owner – Pending |
| OC-22 (v1.2) | Sign off the role and module access matrix in §3.21 (it was filled in by the delivery team). Which roles may write payroll, files, audit and settings? | Permissions, UAT-01 and UAT-11. | Client – Pending |
| OC-23 (v1.2) | Is the AI assistant wanted? Which provider, what tenant data may it read, is it a paid-plan module, and are prompts and images retained? | Privacy, cost and scope. Today it is canned demo replies. | Product owner – Pending |
| OC-24 (v1.2) | Branding scope: branded emails and exported reports, where the logo is stored for real, and who may change branding. | FR-SAAS-11 is partly built: logo upload is built (in memory); emails and exports are not. | Product owner – Pending |
| OC-25 (v1.2) | After a tenant grants support access, what may platform staff see and do? Who approves a platform request, and how do the tenant's grants list and the platform request list connect? | FR-SAAS-10 and audit design. | Product owner – Pending |
| OC-26 (v1.2) | Currency and tax per tenant. Orders use the tenant currency from org settings; platform plan prices are in pounds; are other currencies and VAT needed? | Data model and billing. | Product owner – Pending |
| OC-27 (v1.2) | How should records be shared between modules (tasks created from WhatsApp, report pre-fill from tasks, rosters and recruitment)? | FR-REP-13, FR-WA-02, cross-module links need a shared data layer. v1.2: report pre-fill is done in the route with `lib/report-prefill.ts`; a real shared layer is still open. | Tech lead – Pending |
| OC-28 (v1.2) | Real authentication: identity provider, MFA method, email verification, and removal of the demo role and tenant switchers. | FR-AUTH-01 to 07, FR-SAAS-03. | Tech lead – Pending |
| OC-29 (v1.2) | Which exports are required (reports PDF/XLSX, audit CSV, tenant data export) and who may run them? | FR-REP-12, FR-AUD-04, FR-SAAS-15 (partly OC-13). | Client – Pending |

## 16. Proposed Technical Architecture (Non-binding)

The following is a suggested implementation direction, not a client-approved technology mandate. Final choices should reflect the team's expertise, hosting constraints, integration needs and budget.

- Frontend: responsive web application with reusable form components and accessible UI.
- Backend: authenticated API with server-side validation and role/record-level authorisation.
- Database: relational database for users, tasks, reports, actions, metadata and audit events.
- File storage: private object storage or approved managed storage for evidence and document files; avoid public buckets.
- Background jobs: scheduled report reminders, expiry notifications, exports and transcription processing.
- Integrations: isolated adapters for Google Drive, WhatsApp provider, email and transcription service.
- Observability: structured application logs, error monitoring, health checks and integration retry queues.
- Deployment: separate development/staging/production environments, managed secrets, automated backups and controlled releases.
- (v1.1) Multi-tenancy:
  - Resolve the tenant from the subdomain or session on every request.
  - Use a tenant-aware data-access layer with row-level security.
  - Use tenant-prefixed storage paths and cache keys.
  - Pass the tenant id in every background job.
- (v1.1) Billing: a `billing` module with a provider interface (create checkout, open portal, handle webhook, map provider status → Subscription). Stripe is the first adapter. New payment methods are added as more adapters, and the rest of the app reads only the platform's own Subscription record.
- (v1.1) Frontend: a feature-based structure (`features/<feature>/`). Tenant settings and branding come from the API, never constants.

## 17. Change Control

Any request that changes an approved requirement, adds a new module, changes a third-party integration, or introduces new data/security obligations shall be recorded as a change request. Each change request should describe the business reason, scope, affected requirements, security/privacy implications, cost and schedule impact, and approval. Development of ambiguous high-impact items shall not begin until the client approves the interpretation.

## 18. Client Sign-off

By approving this SRS, the client confirms that the requirements, scope boundaries, report structure, roles and acceptance approach accurately represent the intended system, except for items explicitly marked pending. Pending items must be resolved before the affected feature is implemented or before the relevant phase is accepted.

| **Name** | **Role** | **Signature / approval** | **Date** |
|---|---|---|---|
|  |  |  |  |
|  |  |  |  |

## Appendix A. Traceability (v1.2)

Requirement ID to route and implementing folder. Folders are under `features/` unless stated. "Mock" means the data is a JSON file under `public/data/<feature>/` and edits live in memory (see Appendix B).

| Requirement IDs | Route(s) | Folder | Build status |
|---|---|---|---|
| FR-AUTH-01, FR-AUTH-04, FR-AUTH-05, FR-ONB-01 to 04, FR-SAAS-03, FR-SAAS-04 | `/sign-in`, `/sign-up`, `/forgot-password`, `/onboarding` | `auth` | Mock |
| FR-AUTH-01 (redirect) , FR-RBAC-08 | all `(app)` routes | `proxy.ts` | Cookie based |
| FR-RBAC-01 to 07 | all `(app)` routes | `lib/permissions.ts`, `lib/session.ts`, `shell` | Mock roles |
| FR-ORG-01 to 04, FR-AUTH-02, FR-AUTH-07, FR-SET-01 to 08, FR-SAAS-05, FR-SAAS-15 | `/settings/[tab]` | `settings` | Mock |
| FR-SAAS-06, FR-SAAS-07, FR-SAAS-07a, FR-BILL-01 to 05 | `/settings/billing` | `billing` | Mock Stripe |
| FR-SAAS-11, FR-BRAND-01 to 04 | `/settings/branding` | `settings`, `lib/brand.ts`, `lib/branding.ts`, `hooks/use-branding.ts` | Cookie (name, colour); memory (logo) |
| FR-SAAS-08, FR-SAAS-13, FR-SHELL-01 to 08, FR-NOT-01 | all `(app)` routes | `shell` | Mock |
| FR-NOT-02, FR-NOT-03, FR-NOT-05, FR-SET-06 | `/settings/notifications`, shell bell | `settings`, `shell`; `lib/notify.ts`, `hooks/use-notify-feed.ts` | Mock (no provider) |
| FR-SAAS-09, FR-SAAS-10, FR-SAAS-14, FR-PLAT-01 to 07 | `/platform/**` | `platform` | Mock |
| FR-AUD-01, FR-SRCH-01 to 05 | topbar | `search` | Mock |
| FR-AI-01 to 03 | topbar | `assistant` | Demo |
| FR-AUTH-04 to 06, FR-ACC-01 to 03 | `/account/[tab]` | `account` | Mock |
| FR-TASK-01 to 15 | `/tasks`, `/tasks/[ref]` | `tasks` | Mock |
| FR-REP-01 to 17, section 4 | `/daily-reports`, `/daily-reports/[id]` (FR-REP-12 export, FR-REP-13 pre-fill via `lib/report-prefill.ts`) | `reports` | Mock |
| FR-REV-01 to 07, FR-OUT-01 to 06 | `/manager-attention` | `attention` | Mock |
| FR-STAFF-01 to 05, FR-ROSTER-01 to 03 | `/staff-rosters` | `staff-rosters` | Mock |
| FR-CLIENT-01 to 04 | no dedicated screen (client issues are an attention source and a report section) | `reports`, `attention` | Partial |
| FR-REC-01 to 05 | `/recruitment` | `recruitment` | Mock |
| FR-EFILE-01 to 06, FR-CFILE-01 to 03 | `/files` | `files` | Mock |
| FR-PAY-01 to 05 | `/payroll-issues` | `payroll` | Mock |
| FR-STOCK-01 to 05 | `/orders-stock` | `orders` | Mock |
| FR-WA-01 to 11 | `/whatsapp`, `/settings/integrations` | `whatsapp`, `settings` | Mock (OC-05) |
| FR-AUD-02, FR-AUD-05, FR-AUD-06, FR-AUD-07 | `/audit-log` | `audit` | Mock, CSV export works |
| FR-DASH-01, section 10 | `/` | `dashboard` | Mock |
| FR-GDR-01 to 06 | `/settings/integrations` (status card only) | `settings` | Not implemented beyond a status card |
| FR-MOB-01 to 05 | all | responsive CSS, `shell` install card | Partial |

## Appendix B. Frontend-only and mocked behaviour (v1.2)

The repository is a frontend prototype for client review. A future backend must replace the following. Nothing below is production behaviour.

- All data is JSON under `public/data/<feature>/` read through `lib/data.ts` (from disk). `proxy.ts` answers 404 to any `/data/*` request, so the files are never served over HTTP. Feature stores (`lib/store.ts`) hold edits in browser memory and reset on reload.
- Session: cookies `od-role`, `od-tenant`, `od-auth` and `od-brand-<tenantId>` stand in for authentication, memberships and tenant settings. `proxy.ts` only checks the signed-out cookie (tenant pages and the platform console); both layouts also redirect signed-out visitors. Signing out deletes `od-role` and `od-tenant`. Server actions in `app/actions/session.ts`; the demo "View as" and "Switch company" actions only accept role and tenant ids from the seed lists. A real deployment must replace them with memberships.
- Authorisation is enforced in server components (navigation filtering, data stripping, write checks), not by a backend. FR-AUTH-03 and NFR-SEC-01 still need a real server.
- Tenant isolation (FR-SAAS-01, FR-SAAS-02, NFR-TEN-01) is not implemented; tenants are seed rows. Client stores are scoped by tenant id (store scope key), and WhatsApp-created tasks carry their tenant id, so switching company never shows another tenant's in-memory edits.
- Billing, MFA, email verification, invites, password reset, data export and deletion requests only show toasts or local state.
- Not built at all: real file upload and storage for evidence and documents, Google Drive access policy (FR-GDR), task dependencies (FR-TASK-10), subdomains and custom domains (FR-SAAS-12), per-tenant usage tracking beyond seeded numbers.
- Notifications are a mock (FR-NOT-02, FR-NOT-03, FR-NOT-05): the schedule, due reminders, in-app items and delivery log work, but nothing is sent by email, WhatsApp or push. Real sending still needs a provider.
- Daily report export (FR-REP-12) is real but client-side: files are built in the browser from data already on the page, so a backend must redo it to log exports and enforce access (FR-AUD-05). Report pre-fill (FR-REP-13) suggests from seeded tasks, rosters and recruitment rows.
- WhatsApp, voice transcription and the AI assistant return canned or seeded data. WhatsApp awaits client confirmation (OC-05).
- Tenant-specific names in mock data (company names, people, departments such as Security and Cleaning, the 17:30 deadline and 16:30 and 17:15 reminders, the London timezone) are seed values in `public/data`. They must stay tenant configuration (NFR-CONF-01) and must not be treated as platform constants.
