"use client"

import { useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { useTasksStore } from "../store"
import type { Person, Task } from "../types"
import { NewTaskDialog } from "./new-task-dialog"

// A New task trigger for pages outside /tasks (the dashboard). Opens the dialog in place; only after a successful
// create does it go to the new task. It seeds the tasks store with the same seed + scope as /tasks, so the task
// created here is still there when /tasks/[ref] reads the store.
export function NewTaskButton({
  className,
  children,
  seed,
  scopeKey,
  people,
  departments,
  defaultDept,
  creator,
  today,
  refFloor,
}: {
  className: string
  children: ReactNode
  seed: Task[]
  scopeKey: string
  people: Person[]
  departments: string[]
  defaultDept: string
  creator: { id: string; name: string }
  today: string
  refFloor: number
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  useTasksStore(seed, scopeKey, people, { today, refFloor })

  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {children}
      </button>
      <NewTaskDialog
        open={open}
        onOpenChange={setOpen}
        people={people}
        departments={departments}
        defaultDept={defaultDept}
        creator={creator}
        today={today}
        refFloor={refFloor}
        onCreated={(ref) => router.push(`/tasks/${encodeURIComponent(ref)}`)}
      />
    </>
  )
}
