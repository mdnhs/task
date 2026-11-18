// MOCK registry (B6 rulings I16, I28; T6.9). Features with no backend yet show their static seed only on a demo deployment (server env ENABLE_MOCK_MODULES=1).
// This file is the ONE place that reads the flag and the ONE list of what may touch the mock data layer; test/mock-isolation.test.ts holds the code to it.
export const mockEnabled = (): boolean => process.env.ENABLE_MOCK_MODULES === "1"

/** The mock-only routes: unavailable (page) and hidden (nav, search) unless the flag is on. Every page under a prefix starts with `mockGate(...)`. */
export const MOCK_ROUTES = [
  { prefix: "/manager-attention", label: "Manager Attention" },
  { prefix: "/rosters", label: "Location Rosters" },
  { prefix: "/staff-rosters", label: "Staff & Rosters" },
  { prefix: "/orders-stock", label: "Orders & Stock" },
  { prefix: "/recruitment", label: "Recruitment" },
  { prefix: "/payroll-issues", label: "Payroll Issues" },
  { prefix: "/files", label: "Files" },
  // A sub-page of Settings -> Integrations (no nav entry of its own): the WhatsApp notifications management page.
  { prefix: "/settings/integrations/whatsapp", label: "WhatsApp" },
] as const

/** The permission modules whose screens are mock-only (popular search terms of these are hidden without the flag). */
export const MOCK_MODULES: readonly string[] = ["attention", "roster", "staff", "recruitment", "files", "payroll", "orders"]

export const isMockRoute = (href: string): boolean => MOCK_ROUTES.some((r) => href === r.prefix || href.startsWith(`${r.prefix}/`) || href.startsWith(`${r.prefix}?`))

/**
 * The navigation without the mock-only entries (everything when the flag is on). The seed's badge counts ("Tasks 14", "Manager Attention 4") are mock numbers with no
 * API behind them (found in the T6.9 browser walk), so without the flag no entry carries one.
 */
export const hideMockNav = <T extends { href: string }>(items: readonly T[]): T[] =>
  mockEnabled() ? [...items] : items.filter((i) => !isMockRoute(i.href)).map((i) => Object.fromEntries(Object.entries(i).filter(([k]) => k !== "badge")) as T)

export type ReaderKind =
  | "mock" //      a feature that has no backend yet: its whole data is the seed (shown only behind mockGate / mockEnabled)
  | "catalogue" // static, non-tenant data the product ships: role templates, navigation, plans, entitlement catalogue, option lists, onboarding defaults
  | "display" //   a display-only seed that no API route backs and that carries no tenant data worth hiding (notice banner copy, profile placeholders, search shortcuts)

/** Every file that may import `@/lib/data` (the JSON reader) or call getData(. Adding one means adding a line here, with the reason. */
export const MOCK_DATA_READERS: Readonly<Record<string, { kind: ReaderKind; why: string }>> = {
  "app/(app)/rosters/actions.ts": { kind: "mock", why: "roster rule checks run on the roster seed (mockGate inside)" },
  "app/(app)/rosters/loading.tsx": { kind: "mock", why: "sizes the roster skeleton from the seed; generic skeleton when the flag is off" },
  "app/(app)/rosters/locations/gate.ts": { kind: "mock", why: "location admin gate on the roster seed" },
  "app/(app)/rosters/mine/gate.ts": { kind: "mock", why: "my roster gate on the roster seed" },
  "app/(app)/rosters/page.tsx": { kind: "mock", why: "Location Rosters" },
  "app/actions/onboarding.ts": { kind: "catalogue", why: "country defaults of the onboarding form" },
  "features/account/api.ts": { kind: "display", why: "profile form placeholders (the profile itself is the API's)" },
  "features/assistant/api.ts": { kind: "mock", why: "AI assistant prompts (no assistant backend yet)" },
  "features/attention/api.ts": { kind: "mock", why: "Manager Attention decide queue" },
  "features/auth/api.ts": { kind: "catalogue", why: "plan options and role names of the sign-up and onboarding forms" },
  "features/billing/api.ts": { kind: "catalogue", why: "entitlement catalogue and plan list (the tenant's own state is the API's)" },
  "features/dashboard/mock.ts": { kind: "mock", why: "Coverage & Files card (rosters and employee files)" },
  "features/files/api.ts": { kind: "mock", why: "client files and employee documents" },
  "features/orders/api.ts": { kind: "mock", why: "Orders & Stock" },
  "features/payroll/api.ts": { kind: "mock", why: "Payroll Issues" },
  "features/platform/mock.ts": { kind: "mock", why: "console pages with no API route (plans, invoices, usage, notes)" },
  "features/recruitment/api.ts": { kind: "mock", why: "Recruitment" },
  "features/rosters/api.ts": { kind: "mock", why: "Location Rosters and My roster" },
  "features/search/api.ts": { kind: "mock", why: "search index of the mock modules (empty unless the flag is on); popular terms and quick actions" },
  "features/settings/api.ts": { kind: "catalogue", why: "time zone, colour preset and notification option lists; delivery log seed (no API)" },
  "features/shell/api.ts": { kind: "catalogue", why: "navigation tree" },
  "features/staff-rosters/api.ts": { kind: "mock", why: "Staff & Rosters" },
  "features/whatsapp/api.ts": { kind: "mock", why: "WhatsApp notifications (Settings -> Integrations, Account -> Notifications): FE-only until the backend exists" },
  "lib/entitlements-data.ts": { kind: "catalogue", why: "module and entitlement catalogue" },
  "lib/org.ts": { kind: "catalogue", why: "getMockOrg for the mock pages and the loading skeleton's static org; the real org is the API's" },
  "lib/people.ts": { kind: "mock", why: "getMockPeople for the mock pages; role labels" },
  "lib/platform-notice-data.ts": { kind: "display", why: "platform announcement seed (console settings are client state)" },
  "lib/roles-data.ts": { kind: "catalogue", why: "role templates" },
  "lib/session-route.ts": { kind: "catalogue", why: "role templates and entitlement catalogue joined to the API's membership" },
  "lib/session.ts": { kind: "catalogue", why: "role templates and entitlement catalogue joined to the API's membership" },
  "lib/skeleton-session.ts": { kind: "catalogue", why: "the typical-case session a loading skeleton renders (no network in a loading file)" },
  "lib/workforce.ts": { kind: "mock", why: "staff and roster workforce seed" },
}

/** The loading.tsx files allowed to read the static seed (they belong to mock pages and fall back to a generic skeleton when the flag is off). */
export const MOCK_LOADING_FILES: readonly string[] = [
  "app/(app)/files/loading.tsx",
  "app/(app)/manager-attention/loading.tsx",
  "app/(app)/orders-stock/loading.tsx",
  "app/(app)/payroll-issues/loading.tsx",
  "app/(app)/recruitment/loading.tsx",
  "app/(app)/rosters/loading.tsx",
  "app/(app)/staff-rosters/loading.tsx",
  "app/(app)/staff-rosters/gaps/[id]/loading.tsx",
  "app/(app)/staff-rosters/incidents/new/loading.tsx",
]

/** The only readers a loading.tsx outside that list may call: static catalogue data shipped with the app (role templates, navigation, plan list), never tenant data and never the network. */
export const STATIC_LOADING_READERS: readonly string[] = ["getSkeletonSession", "getSkeletonUser", "getNavigation", "getPlatformNav", "getOnboardingData", "getEntitlements", "getPlans"]

/** The static JSON files under public/data/settings that are option lists, not tenant data (T6.5 carry-in): the settings pages read them through features/settings/api.ts. */
export const STATIC_SETTINGS_FILES: readonly string[] = ["settings/organisation.json", "settings/branding.json", "settings/notifications.json", "settings/delivery-log.json"]
/** The one settings seed that holds per-person data (status and last-active, no API route): read only behind mockEnabled() by getMockUserActivity. */
export const MOCK_SETTINGS_FILES: readonly string[] = ["settings/users.json"]
