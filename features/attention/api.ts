import { getData } from "@/lib/data"
import type { AttentionItem, OutstandingItem } from "./types"

export async function getAttention() {
  const [{ items }, { outstanding }] = await Promise.all([
    getData<{ items: AttentionItem[] }>("attention/items.json"),
    getData<{ outstanding: OutstandingItem[] }>("attention/outstanding.json"),
  ])
  return { items, outstanding }
}
