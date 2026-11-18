import { mockEnabled } from "@/lib/mock-registry"

// The unbacked console pages (plans, invoice ledger and dunning, usage series, notes, change plan, schedule deletion) have no API route (B6 I16). They show their mock seed only on a demo
// deployment (ENABLE_MOCK_MODULES=1, read in one place: lib/mock-registry.ts); otherwise the page is the unavailable state and its nav entry is hidden.
export const unavailablePlatformPage = (): boolean => !mockEnabled()
