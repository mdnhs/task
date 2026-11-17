// Server-only reads for plan entitlements. The pure logic lives in lib/entitlements.ts.
// The tenant's own entitlements come from the API (GET /v1/entitlements, composed into the session by lib/session-core.ts); this file only serves the static plan table.
import { getData } from "./data"
import type { EntitlementsData } from "./entitlements"

export const getEntitlementsData = () => getData<EntitlementsData>("billing/entitlements.json")
