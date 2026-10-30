"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"

import { PageHead } from "@/components/page-head"
import { useDept } from "@/hooks/use-dept"
import { useTasksStore } from "../store"
import type { Person, Project, Task, TaskTemplate } from "../types"
import { NewTaskForm } from "./new-task-form"

// /tasks/new. Seeds the tasks store with the same seed + scope as /tasks (like the list does), so the task created here is in the
// list and on /tasks/[ref] after the client navigation. Save returns to `from`, or opens the new task when `openCreated` is set.
export function NewTaskPage({
  seed,
  scopeKey,
  people,
  departments,
  today,
  refFloor,
  creator,
  templates,
  canManageTemplates,
  projects,
  onlyAssignee,
  from,
  assignee,
  openCreated,
}: {
  seed: Task[]
  scopeKey: string
  people: Person[]
  departments: string[]
  today: string
  refFloor: number
  creator: { id: string; name: string }
  templates: TaskTemplate[]
  canManageTemplates: boolean
  projects: Project[]
  /** Staff roles can only assign to themselves (the picker holds just them). */
  onlyAssignee?: string
  from: string
  /** Preset assignee from `?assignee=` ("" = none). */
  assignee: string
  openCreated: boolean
}) {
  const router = useRouter()
  const dept = useDept()
  useTasksStore(seed, scopeKey, people, { today, refFloor })
  const backLabel = from === "/" ? "← Dashboard" : from.startsWith("/tasks") ? "← All tasks" : "← Back"

  return (
    <>
      <Link href={from} className="td-back">{backLabel}</Link>
      <PageHead title="New task" subtitle="Assign work with an owner, a deadline and the evidence you need back." />
      <div className="card nt-card">
        <NewTaskForm
          people={onlyAssignee ? people.filter((p) => p.id === onlyAssignee) : people}
          departments={departments}
          defaultDept={dept !== "all" && departments.includes(dept) ? dept : (departments[0] ?? "")}
          defaultAssignee={onlyAssignee ?? (assignee || undefined)}
          creator={creator}
          today={today}
          refFloor={refFloor}
          templates={templates}
          canManageTemplates={canManageTemplates}
          scopeKey={scopeKey}
          projects={projects}
          cancelHref={from}
          onCreated={(ref) => router.push(openCreated ? `/tasks/${encodeURIComponent(ref)}` : from)}
        />
      </div>
    </>
  )
}
