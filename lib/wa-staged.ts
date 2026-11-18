import { createStore } from "@/lib/store"
import type { PhoneValue } from "@/lib/phone"

// MOCK (no backend yet): WhatsApp numbers the owner typed for people (Settings -> Users). A number is only STAGED: it shows as "Pending confirmation" until the person
// ticks the opt-in and verifies the code in Account -> Notifications. Nothing is sent before that. Client memory only; keyed by lower-case email.
// `null` = the owner cleared the number. Shared by the settings and whatsapp features through lib/ (features do not import each other). Client-only: the pure
// status rules are in lib/wa-status.ts.
export type StagedNumbers = Record<string, PhoneValue | null>
export const stagedStore = createStore<StagedNumbers>()

export const stageNumber = (email: string, v: PhoneValue | null) => stagedStore.set((m) => ({ ...m, [email.trim().toLowerCase()]: v }))
/** The person confirmed it themselves: the staged number is consumed. */
export const consumeStaged = (email: string) =>
  stagedStore.set((m) => {
    const n = { ...m }
    delete n[email.trim().toLowerCase()]
    return n
  })
