"use client"

import { createStore } from "@/lib/store"

/** Mock clock override ("HH:MM" on the org's today) for the notification SETTINGS preview, so the schedule can be tried before the deadline. null = the org clock.
 * MOCK: the tenant-default notification settings stay mock until their backend exists (ruling I16). Not the bell: the bell lists the API's notifications. */
export const notifyClock = createStore<string | null>()
