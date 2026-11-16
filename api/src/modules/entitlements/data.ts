import { readFileSync } from "node:fs"
import type { EntitlementsData } from "@opsdesk/domain/entitlements"

// Plan facts and the module map are data (FR-M0-20): public/data/billing/{entitlements,plans}.json. The Dockerfile copies both.
const DATA = new URL("../../../../public/data/billing/", import.meta.url)
const readJson = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, DATA), "utf8")) as T

export type PlanFacts = { id: string; name: string; priceMonthly: number; currency: string; trialDays: number; limits: Record<string, number> }

let ent: EntitlementsData | undefined
export const entitlementsData = (): EntitlementsData => (ent ??= readJson<EntitlementsData>("entitlements.json"))

let plans: PlanFacts[] | undefined
export const planFacts = (id: string): PlanFacts => {
  plans ??= readJson<PlanFacts[]>("plans.json")
  const p = plans.find((x) => x.id === id)
  if (!p) throw new Error(`unknown plan ${id}`)
  return p
}
