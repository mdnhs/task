import { getData } from "@/lib/data"
import type { Order } from "./types"

export async function getOrders() {
  const { orders } = await getData<{ orders: Order[] }>("orders/orders.json")
  return orders
}
