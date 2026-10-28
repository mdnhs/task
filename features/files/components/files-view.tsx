"use client"

import { useState } from "react"

import { CountUp } from "@/components/count-up"
import { useSlideDir } from "@/components/data-pagination"
import { FilterSeg } from "@/components/filter-bar"
import { PageHead } from "@/components/page-head"
import { useDept } from "@/hooks/use-dept"
import { docsStore } from "../store"
import type { ClientFile, EmployeeDoc } from "../types"
import { ClientFiles } from "./client-files"
import { EmployeeDocs } from "./employee-docs"

type Tab = "employee" | "client"
const TABS: { value: Tab; label: string }[] = [
  { value: "employee", label: "Employee documents" },
  { value: "client", label: "Client files" },
]

export function FilesView({
  documents,
  clients,
  today,
  tz,
  tzLabel,
  canWrite,
  actor,
  scopeKey,
}: {
  documents: EmployeeDoc[]
  clients: ClientFile[]
  today: string
  tz: string
  tzLabel: string
  canWrite: boolean
  actor: string
  scopeKey: string
}) {
  const [tab, setTab] = useState<Tab>("employee")
  const [stored] = docsStore.useStore(documents, scopeKey)
  const dept = useDept()
  // Client files (second tab) slides in from the right, Employee documents from the left. A pane shown again replays its CSS slide.
  const dir = useSlideDir(TABS.findIndex((t) => t.value === tab))
  const scoped = stored.filter((d) => dept === "all" || d.dept === dept)
  const count = (...s: EmployeeDoc["status"][]) => String(scoped.filter((d) => s.includes(d.status)).length)
  const stats = [
    { title: "Valid", value: count("valid"), note: "Confirmed and in date" },
    { title: "Expiring soon", value: count("expiring"), note: "Renewal needed within 60 days" },
    { title: "Expired or missing", value: count("expired", "missing"), note: "Action needed now" },
    { title: "Awaiting verification", value: count("unverified"), note: "Received, not yet confirmed" },
  ]

  return (
    <>
      <PageHead title="Employee & Client Files" subtitle="Compliance documents, expiry dates and client paperwork" />
      <section className="stats" aria-label="Document summary">
        {stats.map((s, i) => (
          <article key={s.title} className="stat">
            <div className="stat-top"><h3>{s.title}</h3></div>
            <div className="value num"><CountUp value={s.value} delay={0.1 + i * 0.04} /></div>
            <div className="note">{s.note}</div>
          </article>
        ))}
      </section>
      <div className="card files-card">
        <div className="files-tabs">
          <FilterSeg label="Files" value={tab} options={TABS} onChange={(v) => setTab(v as Tab)} />
        </div>
        {/* Both panes stay mounted so each tab keeps its filters and page when switching. */}
        <div hidden={tab !== "employee"} className="od-slide" data-slide={dir}>
          <EmployeeDocs documents={documents} today={today} tz={tz} tzLabel={tzLabel} canWrite={canWrite} actor={actor} scopeKey={scopeKey} />
        </div>
        <div hidden={tab !== "client"} className="od-slide" data-slide={dir}>
          <ClientFiles clients={clients} today={today} tz={tz} tzLabel={tzLabel} actor={actor} scopeKey={scopeKey} />
        </div>
      </div>
    </>
  )
}
