"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { EmptyState } from "@/components/empty-state"
import { apiBrowser } from "@/lib/api/browser"
import { classifyApiError } from "@/lib/api/problem"
import { canEditReport } from "@/lib/shift-report"
import { makeReportsClient } from "../client"
import type { ReportVersionRow, ShiftReport, TemplateSection } from "../types"
import { ReportEditor } from "./report-editor"
import { ReportReview } from "./report-review"

export type ReportPageProps = {
  /** The report the API returned; null = not found (an unknown id and an out-of-scope id look the same, no detail). */
  report: ShiftReport | null
  /** A shift key (`userId:patternId:date`) of the member's OWN shift with no report yet: the page opens it (POST /v1/shift-reports/open) and goes to the report. */
  openKey?: { patternId: string; date: string } | null
  versions: ReportVersionRow[]
  /** The sections of the report's team template (matched by team NAME on the server). */
  template: TemplateSection[]
  /** The owner's display name (the report carries the user id only). */
  owner: string
  /** The signed-in member's user id. */
  meId: string
  /** Tenant wall "now" (date words only) and the same moment as an instant (every comparison). */
  now: string
  nowAt: string
  tz: string
  tzLabel: string
  /** Role may write reports (and the tenant is not suspended). Editing also needs ownership and a draft/returned report. */
  canWrite: boolean
  /** Manager-home role with write access: accept / return (FR-M1-29). */
  canReview: boolean
  /** The role may open tasks (the rows link to them). */
  canOpenTasks: boolean
}

// /daily-reports/[id]: the owner edits a draft or returned report; everyone else (and the owner after submitting) reads it. The mode comes from what the API returned, so a report submitted in
// another tab locks at the next refresh (FR-M1-27).
export function ReportPage(props: ReportPageProps) {
  const { report, openKey, owner, template } = props
  const back = (
    <Link href="/daily-reports" className="td-back">
      ← Shift reports
    </Link>
  )
  if (!report && openKey) return <OpenReport {...props} patternId={openKey.patternId} date={openKey.date} back={back} />
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
  if (canEditReport(report, props.meId, props.canWrite)) return <ReportEditor {...props} report={report} owner={owner} template={template} back={back} />
  return <ReportReview {...props} report={report} owner={owner} template={template} back={back} />
}

/** The member's own shift with no report yet (a virtual inbox row, or the dashboard card): open it, then show it. A shift that has not started, is not theirs or has reporting off is said plainly. */
function OpenReport({ patternId, date, tz, back }: ReportPageProps & { patternId: string; date: string; back: React.ReactNode }) {
  const router = useRouter()
  const [problem, setProblem] = useState<"off" | "none" | "error" | null>(null)
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void makeReportsClient(apiBrowser, tz)
      .open(patternId, date)
      .then((r) => router.replace(`/daily-reports/${r.reportId}`))
      .catch((e) => {
        const { kind, code } = classifyApiError(e)
        setProblem(code === "reporting_off" ? "off" : kind === "not_found" ? "none" : "error")
      })
  }, [patternId, date, tz, router])
  if (!problem) return <div className="card" aria-busy="true"><p className="td-muted">Opening your report…</p></div>
  return (
    <>
      {back}
      <div className="card">
        <EmptyState
          icon="report"
          title={problem === "off" ? "Shift reporting is off" : problem === "none" ? "Report not found" : "Could not open the report"}
          text={problem === "off" ? "Reporting is switched off for this shift, so there is no report to fill in." : problem === "none" ? "There is no shift report with this link that you can open." : "Something went wrong. Try again."}
          action={<Link href="/daily-reports" className="btn btn-outline">Back to shift reports</Link>}
        />
      </div>
    </>
  )
}
