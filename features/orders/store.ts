import { createStore } from "@/lib/store"
import type { Order } from "./types"

export const ordersStore = createStore<Order[]>()
