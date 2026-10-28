import { createStore } from "@/lib/store"
import type { Candidate } from "./types"

export const candidatesStore = createStore<Candidate[]>()
