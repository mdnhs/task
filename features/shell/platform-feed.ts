"use client"

import { createStore } from "@/lib/store"

import type { Notification } from "./types"

/** MOCK until T6.8: the platform console's alerts are static items; their read state lives in this client store so it survives navigation. The company bell is the API's. */
export const platformFeed = createStore<Notification[]>()
