// Plain module (not "use client") so server-rendered skeletons read the real values.
/** Locale of the operator console (not tenant-scoped, so there is no org locale to read). */
export const PLATFORM_LOCALE = "en-IE"
export const TENANTS_PAGE_SIZE = 10
export const SUPPORT_PAGE_SIZE = 10
export const AUDIT_PAGE_SIZE = 5
/** The full audit log page (/platform/audit). */
export const AUDIT_LOG_PAGE_SIZE = 10
export const BILLING_PAGE_SIZE = 10
export const DATA_REQUESTS_PAGE_SIZE = 10
export const PLANS_PATH = "/platform/plans"
export const planEditPath = (id: string) => `${PLANS_PATH}/${encodeURIComponent(id)}/edit`
export const PLAN_NEW_PATH = `${PLANS_PATH}/new`
export const PLAN_NEW_SUBTITLE = "Set the price, limits and modules. It joins the comparison and can be picked for tenants right away."
export const PRICE_CHANGE_NOTICE = "Existing tenants keep their price until renewal."
export const PLAN_EDIT_SUBTITLE = "Changes apply to every tenant on this plan and are recorded in the audit trail."

// Console page heads (D2): each page's title and subtitle (and its nav icon).
export const PAGE_HEADS = {
  overview: { title: "Overview", subtitle: "Revenue, growth and tenant health across the platform", icon: "grid" },
  billing: { title: "Billing", subtitle: "Invoices, failed payments and refunds across every tenant", icon: "receipt" },
  "data-requests": { title: "Data requests", subtitle: "Export, deletion and correction requests and their due dates", icon: "download" },
  audit: { title: "Audit log", subtitle: "Every platform action: who, when, why and what changed", icon: "shield" },
  team: { title: "Team", subtitle: "Platform staff, their roles and two-step verification", icon: "users" },
  settings: { title: "Settings", subtitle: "Payment provider, trial and retention defaults, and announcements", icon: "gear" },
} as const

/** D7: the shortest reason a sensitive action accepts. */
export const REASON_MIN = 10
