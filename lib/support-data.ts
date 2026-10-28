import { getData } from "./data"
import type { SupportAccess } from "./support-access"

// Server only (reads the mock JSON). The shared model and client store are in lib/support-access.ts.
export const getSupportAccess = async () => (await getData<{ requests: SupportAccess[] }>("support/requests.json")).requests
