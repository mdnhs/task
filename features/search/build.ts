import { can, moduleForHref } from "@/lib/permissions"
import type { Module, Role } from "@/lib/types"

import type { QuickAction, SearchItem } from "./types"

// Raw shapes: only the fields the index reads. Kept local so this feature doesn't import other features.
type P = { id: string; name: string }
export type RawSources = {
  people: P[]
  tasks: { ref: string; title: string; dept: string; assignee: string; status: string; due: string }[]
  reports: { id: string; date: string; dept: string; owner: string; status: string }[]
  issues: { id: string; title: string; dept: string; owner: string; status: string; due?: string }[]
  payroll: { ref: string; staff: string; dept: string; type: string; owner: string; status: string; target?: string; createdAt?: string }[]
  orders: { ref: string; item: string; supplier: string; dept: string; requester: string; approval: string; delivery: string; requested?: string; expected?: string }[]
  staff: { id: string; name: string; role: string; dept: string }[]
  candidates: { id: string; name: string; role: string; dept: string; stage: string; owner: string; applied?: string }[]
  clients: { id: string; client: string; site: string; dept: string; contractRef: string; docStatus: string; updated?: string }[]
  documents: { id: string; type: string; staff: string; dept: string; status: string; expiry?: string; received?: string }[]
}

const human = (s: string) => s.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase())
const q = (s: string) => encodeURIComponent(s)

export function buildIndex(src: RawSources): SearchItem[] {
  const name = new Map(src.people.map((p) => [p.id, p.name]))
  const who = (id: string) => name.get(id) ?? id
  return [
    ...src.tasks.map((t) => ({ id: `task:${t.ref}`, type: "task" as const, title: t.title, ref: t.ref, href: `/tasks/${q(t.ref)}`, dept: t.dept, owner: who(t.assignee), status: t.status, date: t.due })),
    ...src.reports.map((r) => ({
      id: `report:${r.id}`, type: "report" as const, title: `${r.dept} daily report, ${r.date}`, ref: r.id, href: `/daily-reports/${q(r.id)}`,
      dept: r.dept, owner: who(r.owner), status: r.status, date: r.date,
    })),
    ...src.issues.map((i) => ({ id: `issue:${i.id}`, type: "issue" as const, title: i.title, ref: i.id, href: `/manager-attention?q=${q(i.id)}`, dept: i.dept, owner: i.owner, status: i.status, date: i.due ?? "" })),
    ...src.payroll.map((p) => ({
      id: `payroll:${p.ref}`, type: "payroll" as const, title: `${human(p.type)}: ${p.staff}`, ref: p.ref, href: `/payroll-issues?q=${q(p.ref)}`,
      dept: p.dept, owner: p.owner, status: p.status, date: p.target ?? p.createdAt ?? "",
    })),
    ...src.orders.map((o) => ({
      id: `order:${o.ref}`, type: "order" as const, title: `${o.item} from ${o.supplier}`, ref: o.ref, href: `/orders-stock?q=${q(o.ref)}`,
      dept: o.dept, owner: o.requester, status: o.approval === "approved" ? o.delivery : o.approval, date: o.expected ?? o.requested ?? "",
    })),
    ...src.staff.map((s) => ({ id: `staff:${s.id}`, type: "staff" as const, title: s.name, ref: s.role, href: `/staff-rosters?q=${q(s.name)}`, dept: s.dept, owner: "", status: "", date: "" })),
    ...src.candidates.map((c) => ({
      id: `candidate:${c.id}`, type: "candidate" as const, title: `${c.name}, ${c.role}`, ref: c.id, href: `/recruitment?q=${q(c.id)}`,
      dept: c.dept, owner: c.owner, status: c.stage, date: c.applied ?? "",
    })),
    ...src.clients.map((c) => ({
      id: `file:${c.id}`, type: "file" as const, title: `${c.client} client file (${c.site})`, ref: c.contractRef, href: `/files?q=${q(c.id)}`,
      dept: c.dept, owner: "", status: c.docStatus, date: c.updated ?? "",
    })),
    ...src.documents.map((d) => ({
      id: `file:${d.id}`, type: "file" as const, title: `${d.type}: ${d.staff}`, ref: d.id, href: `/files?q=${q(d.id)}`,
      dept: d.dept, owner: d.staff, status: d.status, date: d.expiry ?? d.received ?? "",
    })),
  ]
}

/**
 * Server-side role filter: drops every item whose module the role can't read (payroll is restricted for most roles),
 * and scopes staff-home roles to their own tasks and reports (same rule as the Tasks / Reports seeds).
 */
export function filterIndexForRole(items: SearchItem[], role: Role, me: { name: string }): SearchItem[] {
  const staff = role.home === "staff"
  return items.filter((i) => {
    const m = moduleForHref(i.href)
    if (!m || !can(role, m)) return false
    if (staff && (i.type === "task" || i.type === "report")) return i.owner === me.name
    return true
  })
}

export function filterActionsForRole(actions: QuickAction[], role: Role): QuickAction[] {
  return actions.filter((a) => {
    const m = moduleForHref(a.href)
    return !!m && can(role, m, a.write ? "write" : "read")
  })
}

/** Popular searches are tagged with the module they point into; a role only gets terms from modules it can read. */
export function filterPopularForRole(popular: { term: string; module: Module }[], role: Role): string[] {
  return popular.filter((p) => can(role, p.module)).map((p) => p.term)
}
