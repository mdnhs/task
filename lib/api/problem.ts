// Errors of the API as the UI sees them (B6 rulings I10, I22; the table in the plan). Pure: no React, no Next.
// The server's `title`, `message` and any free text are NEVER kept or shown; the UI shows short copy picked by status and code, plus a small "Ref <requestId>".

export type ErrorKind =
  | "unauthenticated" | "session_expired" | "mfa_challenge" | "mfa_enrolment" | "email_not_verified" | "billing_required"
  | "module_not_entitled" | "forbidden" | "not_found" | "version_conflict" | "retry" | "tenant_changed" | "validation" | "unprocessable"
  | "rate_limited" | "upstream" | "network"

// Members of a problem body that are not "extra" (and free text, which is dropped on purpose).
const NOT_EXTRA = new Set(["type", "title", "status", "code", "requestId", "message", "detail", "stack", "error", "error_description"])

/** A non-2xx answer. `message` is `${status} ${code}`: safe to log, never shown. `extra` holds machine members of the body (for example `errors[]`). */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string
  readonly extra: Record<string, unknown>

  constructor(status: number, code: string, requestId = "", extra: Record<string, unknown> = {}) {
    super(`${status} ${code}`)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.requestId = requestId
    this.extra = extra
  }

  /** Reads an error response: problem+json from the API, a Better Auth `{ code, message }` body, or anything else (an HTML page from a proxy: only the status is kept). */
  static async fromResponse(res: Response): Promise<ApiError> {
    let body: Record<string, unknown> | null = null
    try {
      const parsed: unknown = JSON.parse(await res.text())
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>
    } catch {
      body = null
    }
    const rawCode = typeof body?.code === "string" ? body.code : ""
    const code = rawCode ? rawCode.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 64) : "http_error"
    const requestId = (typeof body?.requestId === "string" && body.requestId) || res.headers.get("x-request-id") || ""
    const extra: Record<string, unknown> = {}
    if (body) for (const [k, v] of Object.entries(body)) if (!NOT_EXTRA.has(k)) extra[k] = v
    return new ApiError(res.status, code, requestId, extra)
  }
}

/** Maps any thrown value to one kind (I22: the three MFA shapes become `mfa_challenge` or `mfa_enrolment`). One row per line of the error table. */
export function classifyApiError(e: unknown): { kind: ErrorKind; code: string } {
  if (e instanceof ApiError) return { kind: kindOf(e.status, e.code), code: e.code }
  // fetch rejects with a TypeError on a network failure; an AbortError is a timeout or a cancelled request
  if (e instanceof TypeError || (typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError")) return { kind: "network", code: "network" }
  return { kind: "upstream", code: "unknown" }
}

function kindOf(status: number, code: string): ErrorKind {
  if (status === 401) {
    if (code === "mfa_challenge") return "mfa_challenge"
    if (code === "mfa_enrolment_required") return "mfa_enrolment"
    if (code === "unauthenticated" || code === "session_expired") return "session_expired"
    return "unauthenticated" // for example a wrong password: Better Auth's own code
  }
  if (status === 402) return "billing_required"
  if (status === 403) {
    if (code === "mfa_required") return "mfa_challenge"
    if (code === "email_not_verified") return "email_not_verified"
    if (code === "module_not_entitled") return "module_not_entitled"
    return "forbidden" // device_policy and every other 403
  }
  if (status === 404) return "not_found"
  if (status === 409) {
    if (code === "version_conflict") return "version_conflict"
    if (code === "retry") return "retry"
    if (code === "tenant_changed") return "tenant_changed"
    return "unprocessable" // evidence_not_ready, slug_taken, ...: the code says which
  }
  if (status === 412) return "version_conflict" // If-Match no longer holds (the report template): the same "Changed by someone else"
  if (status === 429) return "rate_limited"
  if (status === 400 || status === 413) return "validation"
  if (status === 422) return "unprocessable"
  if (status >= 500) return "upstream"
  return "unprocessable"
}

/**
 * Which full-page state a refused page READ shows (B6 I10): 403 module_not_entitled is "Not in your plan", any other 403 (a role, a device policy) is the permission state.
 * Anything else is not a gate (the page's error state handles it). A write never uses this: it shows the mapped copy as a toast.
 */
export function gateOf(e: unknown): "plan" | "forbidden" | null {
  const { kind } = classifyApiError(e)
  return kind === "module_not_entitled" ? "plan" : kind === "forbidden" && e instanceof ApiError && e.status === 403 ? "forbidden" : null
}

const KIND_COPY: Record<ErrorKind, string> = {
  unauthenticated: "Check your details and try again.",
  session_expired: "Session expired. Sign in again.",
  mfa_challenge: "Enter your verification code.",
  mfa_enrolment: "Set up two-factor sign-in to continue.",
  email_not_verified: "Verify your email first.",
  billing_required: "Billing needs attention. Read-only for now.",
  module_not_entitled: "Not in your plan.",
  forbidden: "You can't do that.",
  not_found: "Not found.",
  version_conflict: "Changed by someone else.",
  retry: "Busy. Please try again.",
  tenant_changed: "Company changed. Reload the page.",
  validation: "Check the highlighted fields.",
  unprocessable: "That can't be done right now.",
  rate_limited: "Too many attempts, wait a minute.",
  upstream: "Something went wrong. Try again.",
  network: "No connection. Try again.",
}

// Codes whose own copy is more useful than their kind's. Never the server's text.
const CODE_COPY: Record<string, string> = {
  device_policy: "Available on your work PC.",
  mfa_attempts_exceeded: "Too many wrong codes. Wait about 15 minutes.",
  rate_limit_unavailable: "Try again shortly.",
  self_verification: "You can't verify your own task.",
  evidence_not_ready: "Evidence is still being scanned.",
  // Invites (B1/B6): the plan's seats are all used.
  seat_limit: "No seats left. Raise the plan's seats first.",
  already_member: "Already a member.",
  invite_used: "That invite was already accepted.",
  invite_invalid: "That invite is no longer valid. Ask for a new one.",
  invite_expired: "That invite has expired. Ask for a new one.",
  invite_not_found: "That invite is gone.",
  role_not_invitable: "That role can't be given by invite.",
  resend_too_soon: "Sent a moment ago. Wait a minute.",
  // Roles, teams, devices, integrations, privacy and notification settings (B6 T6.5).
  // Tasks, projects, evidence, voice and templates (B6 T6.6).
  archive_expired: "Too late to restore: it was removed more than 30 days ago.",
  assignee_out_of_scope: "You can only assign yourself or your direct reports.",
  cannot_assign_others: "You can only assign yourself.",
  dates_manager_only: "Only a manager changes dates. Propose new dates instead.",
  dependency_cycle: "That would make a loop of dependencies.",
  evidence_locked: "Evidence is locked while the task is under review.",
  evidence_required: "Add the required evidence first.",
  evidence_type_not_allowed: "That type of evidence isn't allowed here.",
  file_infected: "That file failed the malware scan.",
  evidence_not_found: "That file is not available.",
  file_not_found: "That file is not available.",
  file_not_ready: "That file is still being scanned.",
  file_too_large: "That file is too large.",
  mime_not_allowed: "That file type isn't allowed.",
  storage_not_configured: "File storage isn't set up yet.",
  human_required: "Only a person can do this, not an API key.",
  api_key_forbidden_route: "An API key can't do this.",
  support_read_only: "A support session can't change anything.",
  support_forbidden_route: "A support session can't do this.",
  invalid_dates: "Check the dates: the start can't be after the due date.",
  invalid_transition: "That status change isn't allowed.",
  invalid_assignee: "That person can't be assigned to tasks.",
  invalid_repeat: "That repeat rule isn't valid.",
  knock_on_changed: "Other tasks changed. Check the preview and save again.",
  knock_on_out_of_scope: "Some dependent tasks are outside your view, so this can't be applied.",
  knock_on_too_large: "Too many dependent tasks would move.",
  not_a_reviewer: "You can't review this task's evidence.",
  subtask_depth: "A subtask can't have its own subtasks.",
  task_archived: "This task is archived. Restore it first.",
  task_not_archived: "This task isn't archived.",
  task_not_found: "Task not found.",
  voice_too_long: "A voice note can be 2 minutes at most.",
  voice_note_not_found: "There is no voice note on this task.",
  no_proposal: "There is no date proposal to answer.",
  checklist_limit: "That checklist is full.",
  project_not_found: "Project not found.",
  milestone_not_found: "Milestone not found.",
  template_not_found: "Template not found.",
  owner_not_clonable: "The owner role can't be copied.",
  template_locked: "Built-in roles can't be edited. Copy the role first.",
  role_escalation: "That role has more access than yours.",
  team_name_taken: "That name is taken.",
  team_has_shifts: "It still has shifts. Move or remove them first.",
  // Shifts, shift reports, exports and Today (B6 T6.7).
  report_locked: "This report is submitted and locked.",
  report_invalid: "Fill in the required fields.",
  report_not_found: "Report not found.",
  report_not_submitted: "This report is not waiting for review.",
  report_owner_erased: "This member was removed, so the report can't be reviewed.",
  report_file_not_found: "That file is not available.",
  self_review: "You cannot review your own report.",
  comment_required: "Add a comment saying what needs to change.",
  reporting_off: "Shift reporting is off for this shift.",
  shift_not_found: "That shift has no report yet.",
  attachment_limit: "A report holds 5 files at most.",
  item_not_in_shift: "A task row doesn't belong to this shift.",
  invalid_template: "Check the template fields.",
  template_too_large: "The template is too large (64 KB at most).",
  range_too_long: "Pick a shorter range (92 days at most for an export, 31 for the list).",
  invalid_range: "The start date is after the end date.",
  export_too_large: "Too many reports. Narrow the range or the filters.",
  pdf_too_large: "Too big for a PDF. Use Excel or CSV.",
  export_limit: "Three exports are already running. Wait for one to finish.",
  export_not_ready: "The export is not ready yet.",
  report_export_not_found: "That export is gone. Export again.",
  invalid_day_key: "The day changed. Refreshing.",
  invalid_pattern: "Check the shift pattern.",
  invalid_pattern_zone: "Choose a valid time zone.",
  pattern_name_taken: "That team already has a pattern with that name.",
  shift_pattern_not_found: "That shift pattern is gone.",
  shift_assignment_not_found: "That assignment is gone.",
  invalid_assignment: "That assignment isn't possible: check the person, the dates and overlaps.",
  assignment_started: "That assignment has started. End it instead.",
  team_not_found: "Team not found.",
  template_dept_exists: "The report template already has a department with that name.",
  not_a_member: "That person is not a member.",
  device_already_bound: "This device is already set up. Ask an admin to reset it.",
  invalid_enrolment_code: "That code didn't work. Check it, or ask for a new one.",
  invalid_quiet_hours: "Pick two different times.",
  integration_not_configured: "Google is not set up for this workspace yet.",
  invalid_color: "Use a 6 digit hex colour, like #2f6f5e.",
  invalid_logo: "That logo can't be used. Upload it again.",
  invalid_name: "Enter a name between 2 and 80 characters.",
  invalid_timezone: "Choose a timezone from the list.",
  invalid_report_deadline: "Choose the report deadline.",
  request_open: "A request like that is already open.",
  last_owner: "The last owner can't be removed.",
  self_deactivation: "You can't deactivate yourself.",
  request_not_processing: "That request is not waiting on you any more.",
  data_request_not_found: "That request is gone.",
  invalid_outcome: "Choose completed or rejected.",
  invalid_note: "Add a note of 1 to 500 characters.",
  already_deactivated: "Already deactivated.",
  not_deactivated: "Already active.",
  self_request_not_allowed: "You can't make that request about yourself.",
  // Rosters (B8). Short, never the server's text.
  roster_locked: "This week is published. Ask for a change instead.",
  reason_required: "Add a reason first.",
  rule_blocked: "A roster rule blocks this.",
  rule_blocked_office_required: "Only the office can publish over a blocked rule.",
  ineligible: "That person can't take this shift.",
  location_archived: "This location is archived.",
  shift_exists: "That person already has this shift.",
  shift_conflict: "That person already has this shift.",
  already_published: "This week is already published.",
  invalid_override: "Name the rules you are overriding.",
  week_exists_draft: "A draft week already exists there.",
  week_exists: "A week already exists there.",
  targets_version_required: "Reload the weeks you want to replace.",
  invalid_target_version: "Reload the weeks you want to replace.",
  use_direct_edit: "This week is a draft. Edit the shift directly.",
  cannot_move_week: "A shift can't move to another week.",
  invalid_patch: "Check the shift fields.",
  invalid_shift: "Check the shift fields.",
  invalid_shift_type: "That shift type isn't available here.",
  invalid_weeks: "Pick 1 to 12 weeks.",
  location_name_taken: "That location name is taken.",
  shift_type_name_taken: "That shift type name is taken.",
  shift_type_archived: "That shift type is archived.",
  leave_started: "That leave has already started.",
  stale_request: "The shift changed since this was asked. Reject it, or ask again.",
  self_decision: "You can't decide your own request.",
  already_decided: "That was already decided.",
  shift_taken: "Someone else already has this shift.",
  shift_changed: "That shift is no longer the same. Reload and try again.",
  exchange_expired: "That shift has already started.",
  week_published: "That week is already published.",
  week_not_published: "Only a published week has open shifts to claim.",
  shift_not_open: "That shift is not open.",
  shift_started: "That shift has already started.",
  too_many_open: "Too many requests are open. Wait for a decision.",
  cooldown: "Wait a little before offering this shift again.",
  exchange_open: "A request for this shift is already open.",
  invalid_swap: "Pick someone else to swap with.",
  member_not_found: "That person isn't available here.",
  // Locations admin, licences, leave and availability (B8 Task 22).
  leave_overlap: "You already have leave on those days.",
  invalid_leave: "Check the dates and type of that leave.",
  leave_not_open: "That leave can't be changed now.",
  invalid_availability: "Check the times of that window.",
  invalid_coordinates: "Add both coordinates, or neither.",
  invalid_zone_radius: "The zone is 0 to 5000 m.",
  invalid_time_zone: "That time zone isn't known. Try Europe/Dublin.",
  invalid_location: "Check the location's details.",
  invalid_supervisor: "Only active people can supervise.",
  invalid_qualification: "Each licence once, with a real date.",
  invalid_targets: "Staff per day is 0 to 99.",
  // The platform console (B6 T6.8).
  already_suspended: "This tenant is already suspended.",
  not_suspended: "This tenant is not suspended.",
  invalid_reason: "Give a reason of 1 to 500 characters.",
  invalid_days: "Days must be a whole number from 1 to 30.",
  invalid_hours: "Hours must be a whole number from 1 to 24.",
  not_trialing: "This tenant is not on a trial.",
  tenant_not_found: "Workspace not found.",
  grant_exists: "You already have access to this tenant. Revoke it first.",
  grant_not_found: "That access grant is gone.",
  grant_inactive: "That access grant has already ended.",
  last_platform_owner: "The last owner can't be demoted or suspended.",
  platform_forbidden: "Your staff role can't do that.",
  unknown_module: "That module doesn't exist.",
  core_module: "A core module can't be revoked.",
  duplicate_module: "A module is listed twice.",
  invalid_status: "That status isn't valid.",
  invalid_plan: "That plan doesn't exist.",
  // Billing (B3 service): the seat cap is local, the rest are checkout and portal states.
  seat_limit_exceeds_plan: "That is more seats than your plan allows.",
  seats_below_members: "Seats can't be fewer than your active members.",
  already_subscribed: "This company already has a subscription. Use Manage billing.",
  no_customer: "Start a plan first.",
  no_subscription: "There is no active subscription to change.",
  plan_not_purchasable: "That plan can't be bought online yet.",
  billing_provider_error: "The payment provider did not answer. Try again.",
}

/** Short copy for the UI and a "Ref <requestId>" (null when there is none). The raw title, the server text and the code are never returned. */
export function userMessage(e: unknown): { text: string; ref: string | null } {
  const { kind, code } = classifyApiError(e)
  const requestId = e instanceof ApiError ? e.requestId : ""
  return { text: CODE_COPY[code] ?? KIND_COPY[kind], ref: requestId || null }
}

/** A problem+json response made by the web (the BFF): the same body shape as the API's. Never carries upstream text. */
export function problemResponse(status: number, code: string, title: string, requestId: string = crypto.randomUUID(), headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ type: "about:blank", title, status, code, requestId }), {
    status,
    headers: { "content-type": "application/problem+json", "x-request-id": requestId, "cache-control": "no-store", ...headers },
  })
}
