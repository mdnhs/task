"use client"

import Link from "next/link"

import { EmptyState } from "@/components/empty-state"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { formatDate } from "@/lib/dates"
import type { Status } from "@/lib/types"
import { milestoneState, projectProgress } from "../planning"
import { useTasksStore } from "../store"
import type { Person, Project, Task } from "../types"
import { TaskViewTabs } from "./task-view-tabs"

const MS: Record<"done" | "late" | "open", Status> = {
  done: { tone: "ok", label: "Done" },
  late: { tone: "bad", label: "Late" },
  open: { tone: "mute", label: "Open" },
}

/** Projects with milestones (FR-M1-04): progress from their tasks; "View tasks" opens the list filtered to the project. */
export function TaskProjects({ tasks, people, projects, today, scopeKey, refFloor }: { tasks: Task[]; people: Person[]; projects: Project[]; today: string; scopeKey: string; refFloor: number }) {
  const [stored] = useTasksStore(tasks, scopeKey, people, { today, refFloor })
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
            const pr = projectProgress(p, stored)
            return (
              <section key={p.id} className="card pj-card" aria-labelledby={`pj-${p.id}`}>
                <div className="card-head">
                  <div>
                    <h2 id={`pj-${p.id}`} className="td-h">{p.name}</h2>
                    <div className="sub">{lead(p.lead)} · <span className="dep-tag">{p.dept}</span> · due {formatDate(p.due)}</div>
                  </div>
                  <Link href={`/tasks?project=${p.id}`} className="tpl-link">View tasks</Link>
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
                    const s = milestoneState(m, stored, today)
                    return (
                      <li key={m.id}>
                        <span className="pj-ms-dot" data-state={s.state} aria-hidden="true" />
                        <div className="pj-ms-body">
                          <div className="td-tl-text">{m.name}</div>
                          <div className="td-tl-meta num">{formatDate(m.due)} · {s.done}/{s.total} tasks</div>
                        </div>
                        <StatusPill status={MS[s.state]} tick={false} />
                      </li>
                    )
                  })}
                </ol>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
