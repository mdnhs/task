import { createStore } from "@/lib/store"
import type { NotificationPrefs, SecurityState } from "./types"

// Client stores, seeded from the route's JSON (scoped per tenant). Mock persistence: survives client navigation, resets on reload.
export const nameStore = createStore<string>()
export const securityStore = createStore<SecurityState>()
export const prefsStore = createStore<NotificationPrefs>()
