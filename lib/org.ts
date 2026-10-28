import { getData } from "./data"

export type Org = {
  today: string
  timezone: string
  tzLabel: string
  /** ISO 4217 code and BCP 47 locale for money (see lib/money.ts). */
  currency: string
  locale: string
  deadline: string
  reminders: string[]
  departments: string[]
}

export async function getOrg(): Promise<Org> {
  return getData<Org>("shell/org.json")
}
