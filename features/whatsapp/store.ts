import { createStore } from "@/lib/store"
import type { Conversation } from "./types"

export const whatsappStore = createStore<Conversation[]>()
