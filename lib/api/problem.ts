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
  owner_not_clonable: "The owner role can't be copied.",
  template_locked: "Built-in roles can't be edited. Copy the role first.",
  role_escalation: "That role has more access than yours.",
  team_name_taken: "That name is taken.",
  team_has_shifts: "It still has shifts. Move or remove them first.",
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
  self_request_not_allowed: "You can't make that request about yourself.",
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
