export const SEARCH_TYPES = ["task", "report", "issue", "payroll", "order", "staff", "candidate", "file"] as const
export type SearchType = (typeof SEARCH_TYPES)[number]

// One row of the global search index. Built on the server, already filtered by role.
export type SearchItem = {
  id: string
  type: SearchType
  title: string
  ref: string
  href: string
  dept: string
  owner: string
  status: string
  // ISO date or date-time ("" when the record has none).
  date: string
}

export type QuickAction = {
  id: string
  label: string
  href: string
  icon: string
  // Needs write access to the href's module (e.g. "New task").
  write?: boolean
}

export type SearchConfig = { popular: string[]; actions: QuickAction[] }

export type SearchFilters = {
  from: string
  to: string
  dept: string
  owner: string
  status: string
  // "" = any.
  type: SearchType | ""
}

export type FilterKey = keyof SearchFilters

export type ResultGroup = { type: SearchType; label: string; total: number; items: SearchItem[] }
