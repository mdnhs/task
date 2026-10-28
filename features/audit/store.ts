import { createStore } from "@/lib/store"
import type { AuditEvent } from "./types"

// Seeded from the fetched events; exports append to it so the log shows them (resets on reload, like other mock stores).
export const auditStore = createStore<AuditEvent[]>()
