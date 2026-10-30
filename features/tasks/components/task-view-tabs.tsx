import Link from "next/link"

/** The task views (FR-M1-05): each is its own route so each has an exact loading skeleton. */
export const TASK_VIEWS = [
  { href: "/tasks", key: "list", label: "List" },
  { href: "/tasks/board", key: "board", label: "Board" },
  { href: "/tasks/calendar", key: "calendar", label: "Calendar" },
  { href: "/tasks/projects", key: "projects", label: "Projects" },
  { href: "/tasks/archive", key: "archive", label: "Archive" },
] as const
export type TaskViewKey = (typeof TASK_VIEWS)[number]["key"]

export function TaskViewTabs({ active }: { active: TaskViewKey }) {
  return (
    <nav className="seg od-seg tv-tabs" aria-label="Task views">
      {TASK_VIEWS.map((v) => (
        <Link key={v.key} href={v.href} aria-current={v.key === active ? "page" : undefined} className="tv-tab">
          {v.key === active && <span className="seg-ind" aria-hidden="true" />}
          <span className="seg-lbl">{v.label}</span>
        </Link>
      ))}
    </nav>
  )
}
