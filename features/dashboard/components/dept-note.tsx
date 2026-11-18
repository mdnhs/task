"use client"

import { useDept } from "@/hooks/use-dept"

/** The API's summary, closed-tasks chart and attention feed have no department split, so a department picked in the topbar does not narrow them: say so in one line. */
export function DeptNote() {
  const dep = useDept()
  if (dep === "all") return null
  return <p className="td-muted">Figures and attention show all departments.</p>
}
