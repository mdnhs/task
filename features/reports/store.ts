import { createStore } from "@/lib/store"
import type { Report } from "./types"

export const reportsStore = createStore<Report[]>()
