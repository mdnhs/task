"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"

import { PageHead } from "@/components/page-head"
import { useDept } from "@/hooks/use-dept"
import type { Person, Project, TaskTemplate } from "../types"
import { NewTaskForm } from "./new-task-form"
import type { PatternChoice } from "./repeat-field"

// /tasks/new. Save returns to `from`, or opens the new task when `openCreated` is set. Everything the form offers comes from the API as the signed-in member:
// the people they may assign (the API enforces it again: 422 assignee_out_of_scope), the department teams, the templates and the projects.
export function NewTaskPage({
  people,
  departments,
  today,
  templates,
  canManageTemplates,
  projects,
  patterns,
  onlyAssignee,
  from,
  assignee,
  openCreated,
}: {
  people: Person[]
  departments: { id: string; name: string }[]
  today: string
  templates: (TaskTemplate & { version: number; teamId: string | null })[]
  canManageTemplates: boolean
  projects: Project[]
  patterns: PatternChoice[]
  /** Staff roles can only assign to themselves (the picker holds just them). */
  onlyAssignee?: string
  from: string
  /** Preset assignee from `?assignee=` ("" = none). */
  assignee: string
  openCreated: boolean
}) {
  const router = useRouter()
  const dept = useDept()
  const backLabel = from === "/" ? "← Dashboard" : from.startsWith("/tasks") ? "← All tasks" : "← Back"

  return (
    <>
      <Link href={from} className="td-back">{backLabel}</Link>
      <PageHead title="New task" subtitle="Assign work with an owner, a deadline and the evidence you need back." />
      <div className="card nt-card">
        <NewTaskForm
          people={onlyAssignee ? people.filter((p) => p.id === onlyAssignee) : people}
          departments={departments}
          defaultDept={dept !== "all" && departments.some((d) => d.name === dept) ? dept : (departments[0]?.name ?? "")}
          defaultAssignee={onlyAssignee ?? (assignee || undefined)}
          today={today}
          templates={templates}
          canManageTemplates={canManageTemplates}
          projects={projects}
          patterns={patterns}
          cancelHref={from}
          onCreated={(ref) => router.push(openCreated ? `/tasks/${encodeURIComponent(ref)}` : from)}
        />
      </div>
    </>
  )
}
