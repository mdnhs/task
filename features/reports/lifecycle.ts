import { isOverdue } from "@/lib/dates"
import type { Report, ReportStatus, TemplateSection } from "./types"

// Pure report lifecycle rules (SRS §3.4, §4.2, BR-02). No React, no I/O.

// SRS §4.2 "Permitted next states", split by who acts.
export function reportTransitions(s: ReportStatus, actor: "owner" | "reviewer"): ReportStatus[] {
  if (actor === "owner") {
    switch (s) {
      case "draft":
        return ["draft", "submitted"]
      case "returned":
        return ["draft", "resubmitted"]
      case "overdue":
        return ["submitted"] // submitted late; the overdue state stays in the audit history
      default:
        return []
    }
  }
  switch (s) {
    case "submitted":
    case "resubmitted":
      return ["reviewed", "returned"]
    case "reviewed":
      return ["reviewed"] // changes after review go through the amendment workflow
    default:
      return []
  }
}

const ADD_ENTRY = "Add at least one entry or mark No issues"
const NIL = "Confirm each section has no issues, or add details"

export function validateReport(r: Report, t: TemplateSection[], skip: string[] = []): { key: string; section: string; message: string }[] {
  const errors: { key: string; section: string; message: string }[] = []
  for (const s of t) {
    if (skip.includes(s.id)) continue // e.g. a restricted section this role cannot read (SRS §4.4)
    for (const f of s.fields) {
      if (!f.required) continue
      const key = `${s.id}.${f.id}`
      const v = r.fields[key]
      if (r.nil) {
        // BR-04: a nil report is explicit, and every required field must say no issues / not applicable.
        if (v?.state !== "no_issues" && v?.state !== "na") errors.push({ key, section: s.id, message: NIL })
      } else if (!v?.state) {
        errors.push({ key, section: s.id, message: ADD_ENTRY })
      } else if ((v.state === "details" || v.state === "action_required") && v.entries.length === 0) {
        errors.push({ key, section: s.id, message: ADD_ENTRY })
      }
    }
  }
  return errors
}

export function reportProgress(r: Report, t: TemplateSection[]): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const s of t)
    for (const f of s.fields) {
      total++
      if (r.fields[`${s.id}.${f.id}`]?.state) done++
    }
  return { done, total }
}

// BR-02: late = actual submission after the deadline on the report date. The original timestamp is never changed.
export function isLateSubmission(r: Report, deadline: string): boolean {
  if (!r.submittedAt) return false
  return isOverdue(`${r.date}T${deadline}:00`, r.submittedAt)
}

// A section is complete when every required field in it has a state. Same unit as the dashboard ("7 of 10 sections complete").
export function sectionProgress(r: Report, t: TemplateSection[]): { done: number; total: number } {
  const done = t.filter((s) => s.fields.every((f) => !f.required || r.fields[`${s.id}.${f.id}`]?.state)).length
  return { done, total: t.length }
}
