import { formatDate } from "@/lib/dates"

import { SEARCH_TYPES } from "./types"
import type { FilterKey, ResultGroup, SearchFilters, SearchItem, SearchType } from "./types"

export const EMPTY_FILTERS: SearchFilters = { from: "", to: "", dept: "", owner: "", status: "", type: "" }
export const GROUP_LIMIT = 5

export const TYPE_LABELS: Record<SearchType, string> = {
  task: "Tasks",
  report: "Daily reports",
  issue: "Manager attention",
  payroll: "Payroll issues",
  order: "Orders",
  staff: "Staff",
  candidate: "Candidates",
  file: "Files",
}

export const TYPE_ICONS: Record<SearchType, string> = {
  task: "task",
  report: "report",
  issue: "flag",
  payroll: "wallet",
  order: "box",
  staff: "roster",
  candidate: "userplus",
  file: "folder",
}

export const humanStatus = (s: string) => s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase())

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")

export function tokens(q: string): string[] {
  return norm(q).split(/\s+/).filter(Boolean)
}

const wordStart = (hay: string, t: string) => hay.startsWith(t) || hay.includes(" " + t) || hay.includes("-" + t)

/** Score of one item for the query (0 = no match). Every token must match a field; ref and title hits outrank the rest. */
export function scoreItem(item: SearchItem, q: string): number {
  const ts = tokens(q)
  if (ts.length === 0) return 0
  const title = norm(item.title)
  const ref = norm(item.ref)
  const rest = norm([item.owner, item.dept, humanStatus(item.status), TYPE_LABELS[item.type]].join(" "))
  const whole = ts.join(" ")
  let score = 0
  if (ref === whole) score += 100
  else if (ref.startsWith(whole)) score += 70
  if (title.startsWith(whole)) score += 40
  for (const t of ts) {
    if (ref.includes(t)) score += 20
    else if (wordStart(title, t)) score += 15
    else if (title.includes(t)) score += 8
    else if (rest.includes(t)) score += 3
    else return 0
  }
  return score
}

export function applyFilters(items: SearchItem[], f: SearchFilters): SearchItem[] {
  return items.filter((i) => {
    const d = i.date.slice(0, 10)
    if (f.from && (!d || d < f.from)) return false
    if (f.to && (!d || d > f.to)) return false
    if (f.dept && i.dept !== f.dept) return false
    if (f.owner && i.owner !== f.owner) return false
    if (f.status && i.status !== f.status) return false
    if (f.type && i.type !== f.type) return false
    return true
  })
}

/** Filtered + ranked matches (best first; ties: newest date, then title). An empty query with active filters lists every filtered item. */
export function searchItems(items: SearchItem[], q: string, f: SearchFilters = EMPTY_FILTERS): SearchItem[] {
  const pool = applyFilters(items, f)
  const byDate = (a: SearchItem, b: SearchItem) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title)
  if (tokens(q).length === 0) return countFilters(f) > 0 ? [...pool].sort(byDate) : []
  return pool
    .map((item) => ({ item, s: scoreItem(item, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || byDate(a.item, b.item))
    .map((x) => x.item)
}

/** Groups by type in the order of each type's best hit; each keeps its total count but shows at most `limit` rows. */
export function groupResults(items: SearchItem[], limit = GROUP_LIMIT): ResultGroup[] {
  const order: SearchType[] = []
  const map = new Map<SearchType, SearchItem[]>()
  for (const i of items) {
    if (!map.has(i.type)) {
      map.set(i.type, [])
      order.push(i.type)
    }
    map.get(i.type)!.push(i)
  }
  return order.map((type) => ({ type, label: TYPE_LABELS[type], total: map.get(type)!.length, items: map.get(type)!.slice(0, limit) }))
}

export type Segment = { text: string; hit: boolean }

/** Splits `text` into hit / non-hit runs for every query token (case- and accent-insensitive). */
export function highlight(text: string, q: string): Segment[] {
  const ts = tokens(q)
  if (ts.length === 0 || !text) return [{ text, hit: false }]
  const hay = norm(text)
  // NFD can change length for accented chars; fall back to no highlight rather than misalign.
  if (hay.length !== text.length) return [{ text, hit: false }]
  const mask = new Array<boolean>(text.length).fill(false)
  for (const t of ts) {
    let at = hay.indexOf(t)
    while (at !== -1) {
      for (let k = at; k < at + t.length; k++) mask[k] = true
      at = hay.indexOf(t, at + t.length)
    }
  }
  const out: Segment[] = []
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1]
    if (last && last.hit === mask[i]) last.text += text[i]
    else out.push({ text: text[i], hit: mask[i] })
  }
  return out
}

const FILTER_ORDER: FilterKey[] = ["from", "to", "dept", "owner", "status", "type"]

export function countFilters(f: SearchFilters): number {
  return FILTER_ORDER.filter((k) => f[k] !== "").length
}

export type FilterChip = { key: FilterKey; label: string }

export function filterChips(f: SearchFilters): FilterChip[] {
  const label: Record<FilterKey, (v: string) => string> = {
    from: (v) => `From ${formatDate(`${v}T00:00:00`)}`,
    to: (v) => `To ${formatDate(`${v}T00:00:00`)}`,
    dept: (v) => v,
    owner: (v) => `Owner: ${v}`,
    status: (v) => humanStatus(v),
    type: (v) => TYPE_LABELS[v as SearchType] ?? v,
  }
  return FILTER_ORDER.filter((k) => f[k] !== "").map((k) => ({ key: k, label: label[k](f[k]) }))
}

/** Backspace on an empty query: drops the last active chip. Returns the same object when nothing is active. */
export function removeLastFilter(f: SearchFilters): SearchFilters {
  const chips = filterChips(f)
  if (chips.length === 0) return f
  return { ...f, [chips[chips.length - 1].key]: "" }
}

/** Distinct owners / statuses present in the (role-filtered) index, for the filter selects. */
export function filterOptions(items: SearchItem[]) {
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b))
  return {
    owners: uniq(items.map((i) => i.owner)),
    statuses: uniq(items.map((i) => i.status)),
    types: SEARCH_TYPES.filter((t) => items.some((i) => i.type === t)),
  }
}
