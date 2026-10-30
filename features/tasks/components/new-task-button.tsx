import type { ReactNode } from "react"
import Link from "next/link"

import { newTaskHref } from "../new-task"

// A New task trigger for pages outside /tasks (the dashboard's "New Task" and "Assign Task"). It links to the /tasks/new page;
// Cancel returns to `from`, and Save opens the new task (what the old dialog's onCreated did here).
export function NewTaskButton({
  className,
  children,
  from,
  assignee,
}: {
  className: string
  children: ReactNode
  /** The page the trigger sits on, e.g. "/" for the dashboard. */
  from: string
  /** Optional preset assignee (Person.id). */
  assignee?: string
}) {
  return (
    <Link href={newTaskHref({ from, assignee, openCreated: true })} className={className}>
      {children}
    </Link>
  )
}
