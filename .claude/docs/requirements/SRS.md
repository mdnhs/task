<!-- Converted from public/Office_Operations_SRS_v1.0.docx (v1.0, 16 Oct 2026).
     v1.1 (28 Oct 2026) adds the SaaS / multi-tenant requirements. These exist only in this markdown, not in the .docx.
     Do not re-convert the .docx over this file without carrying the v1.1 additions across. Search "v1.1" to find them. -->

# Software Requirements Specification

**Office Operations, Task Management & Daily Reporting System**

A multi-tenant SaaS product for Security and Cleaning Operations

Version 1.1 | Draft for Client Review
28 October 2026

Prepared as a development baseline from the requirements shared by the client. Items marked Pending Client Confirmation must be approved before the relevant feature is finalised.

## Document Control

| **Field** | **Value** |
|---|---|
| Document title | Software Requirements Specification (SRS) |
| System name | Office Operations, Task Management & Daily Reporting System (working title) |
| Version | 1.1 – Draft for client review (adds SaaS / multi-tenancy) |
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

**FR-REP-13** (SHOULD): The system should pre-fill linked information from tasks/rosters/recruitment records where feasible, with the report owner able to review it before submission.

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

**FR-NOT-03** (SHOULD): The system should notify designated managers when a report is overdue or an urgent item is escalated.

**FR-NOT-04** (MUST): Notification channels and timing shall be configurable; the system shall avoid exposing sensitive details in notification previews.

**FR-NOT-05** (MUST): The application shall record delivery/processing status where the notification provider supports it.

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

**FR-AUD-02** (MUST): The system shall record who created, updated, submitted, reviewed, approved, rejected or closed a record and when.

**FR-AUD-03** (MUST): Audit records shall be protected from ordinary users editing or deleting them.

**FR-AUD-04** (SHOULD): Authorised users should export reports to PDF and/or CSV/XLSX subject to access controls.

**FR-AUD-05** (MUST): Exports shall be logged when they contain sensitive employee, client or payroll data.

### 3.20 Multi-tenancy and SaaS platform (v1.1)

**FR-SAAS-01** (MUST): Every business record (users' memberships, tasks, reports, evidence, issues, files, audit events, settings) shall carry a tenant identifier. The server shall scope every query and file access to the signed-in user's tenant.

**FR-SAAS-02** (MUST): A user from one tenant shall never be able to read, change, search, export or be notified about another tenant's data, including through IDs, URLs, file links, exports, caches or background jobs.

**FR-SAAS-03** (MUST): A new organisation shall be able to sign up and get a working tenant:
- create the organisation and its Tenant Owner account;
- verify email;
- pick a plan or start a trial;
- go through guided setup: departments, timezone, report deadline, report template and inviting users.

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

**FR-SAAS-07b** (SHOULD): Stripe webhook events shall be verified by signature and processed idempotently. They should also be stored as Integration Events so subscription state can be audited and replayed.

**FR-SAAS-07c** (COULD): Later phases could add payment methods Stripe itself supports, such as SEPA/BACS direct debit and wallets, by enabling them in Stripe. Non-Stripe providers come in through the FR-SAAS-07a adapter.

**FR-SAAS-08** (MUST): If a subscription lapses or a tenant is suspended, the tenant shall become read-only (with export allowed) and not be deleted immediately. Deletion shall follow the published retention period and be confirmed by the Tenant Owner.

**FR-SAAS-09** (MUST): A Platform Super Admin console shall list tenants, plans, subscription status and usage. It shall let staff suspend or reactivate tenants and manage plans, without showing tenant operational data by default.

**FR-SAAS-10** (MUST): Platform support access to a tenant's data shall require the tenant's explicit, time-limited permission. It shall be fully audited and visible to the Tenant Owner.

**FR-SAAS-11** (SHOULD): Tenants should be able to set their name, logo and brand colour. These appear in the app shell, emails and exported reports.

**FR-SAAS-12** (SHOULD): Each tenant should get its own subdomain (for example `acme.<product-domain>`). A custom domain COULD be offered on higher plans.

**FR-SAAS-13** (SHOULD): A user should be able to belong to more than one tenant with a different role in each, and switch tenant without signing out.

**FR-SAAS-14** (SHOULD): The platform should track per-tenant usage (active users, storage, messages, transcription minutes) for plan limits, billing and support.

**FR-SAAS-15** (MUST): A Tenant Owner shall be able to export all of the tenant's data in a common format, and request full deletion when leaving.

**FR-SAAS-16** (SHOULD): Integrations such as Google Drive, WhatsApp, email sender and transcription should be connected per tenant, using that tenant's own credentials or a platform account scoped to that tenant. One tenant's tokens shall never be used for another tenant.

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
| Task | id, title, description, owner, creator, department, priority, status, due date, completion date | May link to report, client, roster, evidence and issue. |
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
| OC-14 | What reminder schedule should be used before/after 5:30 PM? | Notification rules. | Client – Pending |
| OC-15 | Is the expected product a responsive web app/PWA or a native Android app? | Delivery estimate and platform scope. | Client – Proposed web app; confirm |
| OC-16 (v1.1) | Pricing model: per user, per site, or flat tiers? Is there a free trial, and how long? | Plan limits and billing design. | Product owner – Pending |
| OC-17 (v1.1) | Payment provider: **Stripe** for now; other methods may be added later (FR-SAAS-07a). Still open: currencies, and VAT/tax handling (Stripe Tax or manual). | Billing integration and tax. | Product owner – Provider decided (Stripe); tax pending |
| OC-18 (v1.1) | Self-serve sign-up, or sales-led onboarding only? | Onboarding flow and platform admin tooling. | Product owner – Pending |
| OC-19 (v1.1) | Isolation model: shared database with row-level security, schema per tenant, or database per tenant? | Cost, scaling and compliance. | Tech lead – Pending |
| OC-20 (v1.1) | Hosting data region(s); do some tenants need a specific region? | Compliance (for example UK/EU GDPR) and infrastructure. | Product owner – Pending |
| OC-21 (v1.1) | Subdomains and custom domains: on which plans? | Routing, TLS and branding. | Product owner – Pending |

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

