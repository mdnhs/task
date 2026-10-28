import { createStore } from "@/lib/store"

// Saved tenant logos (data URLs), keyed by tenant id. The branding panel writes, the app shell reads (FR-SAAS-11).
// In-memory like the other mock stores: it survives client navigation and resets on reload.
export const logoStore = createStore<Record<string, string>>()

export function useTenantLogo(tenantId: string | undefined) {
  const [logos, set] = logoStore.useStore({})
  const setLogo = (id: string, logo: string) =>
    set((prev) => {
      const next = { ...prev }
      if (logo) next[id] = logo
      else delete next[id]
      return next
    })
  return [tenantId ? logos[tenantId] ?? "" : "", setLogo] as const
}
