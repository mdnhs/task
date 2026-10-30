"use client"

import { useCallback, useMemo } from "react"
import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { canEditReport, reportState } from "@/lib/shift-report"
import type { ExportMeta } from "../export"
import { reportsStore } from "../store"
import type { ReportsSeed, ShiftReport } from "../types"
import { ReportEditor } from "./report-editor"
import { ReportReview } from "./report-review"

export type ReportPageProps = {
  id: string
  seed: ReportsSeed
  now: string
  tz: string
  tzLabel: string
  /** Role may write reports (and the tenant is not suspended). Editing also needs ownership and a draft/returned report. */
  canWrite: boolean
  /** Manager-home role with write access: accept / return (FR-M1-29). */
  canReview: boolean
  /** Display name written on versions, comments and task timelines. */
  me: string
  tenantId: string
  exportMeta: ExportMeta
}

// /daily-reports/[id]: the owner edits a draft or returned report; everyone else (and the owner after submitting) reads it.
// The mode is derived from the store, so a report submitted in this session locks at once (FR-M1-27).
export function ReportPage(props: ReportPageProps) {
  const { id, seed } = props
  const [reports, setReports] = reportsStore.useStore(seed.reports, seed.scopeKey)
  const report = reports.find((r) => r.id === id)
  const apply = useCallback((fn: (r: ShiftReport) => ShiftReport) => setReports((prev) => prev.map((r) => (r.id === id ? fn(r) : r))), [setReports, id])
  const people = useMemo(() => new Map(seed.people.map((p) => [p.id, p])), [seed.people])

  if (!report) {
    return (
      <div className="card">
        <EmptyState
          icon="report"
          title="Report not found"
          text="There is no shift report with this link that you can open."
          action={<Link href="/daily-reports" className="btn btn-outline">Back to shift reports</Link>}
        />
      </div>
    )
  }
  const owner = people.get(report.personId)?.name ?? report.personId
  const template = seed.templates[report.team] ?? []
  const back = (
    <Link href="/daily-reports" className="td-back">
      ← Shift reports
    </Link>
  )
  const state = reportState(report, props.now, props.tz)
  if (canEditReport(report, seed.meId, props.canWrite && seed.scope === "own"))
    return <ReportEditor {...props} report={report} owner={owner} template={template} state={state} apply={apply} back={back} />
  return <ReportReview {...props} report={report} owner={owner} template={template} state={state} apply={apply} back={back} />
}
