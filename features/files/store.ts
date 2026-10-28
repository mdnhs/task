import { createStore } from "@/lib/store"
import type { ClientFile, EmployeeDoc } from "./types"

export const docsStore = createStore<EmployeeDoc[]>()

export const clientsStore = createStore<ClientFile[]>()
