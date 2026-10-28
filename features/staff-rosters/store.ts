import { createStore } from "@/lib/store"
import type { Incident, RosterGap } from "./types"

export const incidentsStore = createStore<Incident[]>()
export const gapsStore = createStore<RosterGap[]>()
