import { createStore } from "@/lib/store"
import type { NotificationPrefs } from "./types"

// Client stores, seeded from the route's JSON (scoped per tenant). Mock persistence: survives client navigation, resets on reload.
export const nameStore = createStore<string>()
export const prefsStore = createStore<NotificationPrefs>()
