"use client"

import { useState } from "react"
import Link from "next/link"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { formatDate } from "@/lib/dates"
import type { Status } from "@/lib/types"
import type { Person, Project } from "../types"
import { createCatalog } from "../catalog"
import { useTaskWrites } from "../use-task-writes"
import { TaskViewTabs } from "./task-view-tabs"

const MS: Record<"done" | "late" | "open", Status> = {
  done: { tone: "ok", label: "Done" },
  late: { tone: "bad", label: "Late" },
  open: { tone: "mute", label: "Open" },
}

/** Projects with milestones (FR-M1-04): progress from their tasks; "View tasks" opens the list filtered to the project. */
export function TaskProjects({ people, projects, canDelete }: { people: Person[]; projects: Project[]; /** Project and milestone deletes are for managers who see everything (403 for a team-scope manager). */ canDelete: boolean }) {
  const { act } = useTaskWrites([])
  const [asking, setAsking] = useState<{ project: Project; milestone?: Project["milestones"][number] } | null>(null)
  const lead = (id: string) => people.find((p) => p.id === id)?.name ?? id
  return (
    <>
      <PageHead title="Tasks" subtitle={`${projects.length} projects`} />
      <TaskViewTabs active="projects" />
      {projects.length === 0 ? (
        <div className="card"><EmptyState icon="task" title="No projects yet" text="Projects group tasks with milestones and deadlines." /></div>
      ) : (
        <div className="pj-grid">
          {projects.map((p) => {
            const pr = p.progress ?? { done: 0, total: 0, pct: 0 }
            return (
              <section key={p.id} className="card pj-card" aria-labelledby={`pj-${p.id}`}>
                <div className="card-head">
                  <div>
                    <h2 id={`pj-${p.id}`} className="td-h">{p.name}</h2>
                    <div className="sub">{lead(p.lead)} · <span className="dep-tag">{p.dept}</span> · {p.due ? `due ${formatDate(p.due)}` : "no due date"}</div>
                  </div>
                  <div className="ar-btns">
                    <Link href={`/tasks?project=${p.id}`} className="tpl-link">View tasks</Link>
                    {canDelete && <button type="button" className="tpl-link bad" onClick={() => setAsking({ project: p })}>Delete</button>}
                  </div>
                </div>
                <p className="pj-desc">{p.description}</p>
                <div className="pj-prog">
                  <span className="num">{pr.done} of {pr.total} tasks done · {pr.pct}%</span>
                  <div className="progress ev-meter" role="progressbar" aria-label={`${p.name} progress`} aria-valuenow={pr.pct} aria-valuemin={0} aria-valuemax={100}>
                    <i style={{ transform: `scaleX(${pr.pct / 100})` }} />
                  </div>
                </div>
                <ol className="pj-ms">
                  {p.milestones.map((m) => {
                    const s = { state: m.state ?? "open", done: m.done ?? 0, total: m.total ?? 0 }
                    return (
                      <li key={m.id}>
                        <span className="pj-ms-dot" data-state={s.state} aria-hidden="true" />
                        <div className="pj-ms-body">
                          <div className="td-tl-text">{m.name}</div>
                          <div className="td-tl-meta num">{formatDate(m.due)} · {s.done}/{s.total} tasks</div>
                        </div>
                        <StatusPill status={MS[s.state]} tick={false} />
                        {canDelete && <button type="button" className="tpl-link bad" aria-label={`Delete milestone ${m.name}`} onClick={() => setAsking({ project: p, milestone: m })}>Delete</button>}
                      </li>
                    )
                  })}
                </ol>
              </section>
            )
          })}
        </div>
      )}
      <ConfirmDialog
        open={!!asking}
        onOpenChange={(o) => !o && setAsking(null)}
        title={asking?.milestone ? "Delete this milestone?" : "Delete this project?"}
        text={asking?.milestone ? `${asking.milestone.name} is removed. Its tasks stay.` : `${asking?.project.name ?? ""} is removed. Its tasks stay, without a project.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          const a = asking
          if (!a) return
          await act(`del:${a.milestone?.id ?? a.project.id}`, () => (a.milestone ? createCatalog().deleteMilestone(a.project.id, a.milestone.id) : createCatalog().deleteProject(a.project.id)), { success: a.milestone ? "Milestone deleted" : "Project deleted" })
        }}
      />
    </>
  )
}
