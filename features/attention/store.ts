import { createStore } from "@/lib/store"
import type { AttentionItem, OutstandingItem } from "./types"

export const attentionStore = createStore<AttentionItem[]>()
export const outstandingStore = createStore<OutstandingItem[]>()
