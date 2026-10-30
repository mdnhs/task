export type PlanLimits = { activeUsers: number; storageGb: number; messages: number; transcriptionMinutes: number }
export type Plan = { id: string; name: string; priceMonthly: number; currency: string; trialDays: number; limits: PlanLimits }
export type SubscriptionRecord = { planId: string; status: string; renewsOn: string; cardLast4: string | null }
export type Usage = PlanLimits
export type InvoiceStatus = "paid" | "failed" | "open"
export type Invoice = { id: string; number: string; date: string; amount: number; currency: string; status: InvoiceStatus; description: string }

export const USAGE_ROWS: { key: keyof PlanLimits; label: string; unit: string }[] = [
  { key: "activeUsers", label: "Active users", unit: "" },
  { key: "storageGb", label: "Storage", unit: " GB" },
  { key: "messages", label: "Messages", unit: "" },
  { key: "transcriptionMinutes", label: "Transcription", unit: " min" },
]
