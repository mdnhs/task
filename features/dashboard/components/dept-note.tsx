"use client"

import { useDept } from "@/hooks/use-dept"

/** With a department picked, the figures, chart, deadline rows and table are that team's (B8 Task 24, `teamId`); the attention feed has no team filter, so say so in one line. A department
 * no team has (`unknown`) keeps the whole scope's figures. */
export function DeptNote({ unknown = false }: { unknown?: boolean }) {
  const dep = useDept()
  if (dep === "all") return null
  return <p className="td-muted">{unknown ? "Figures show all departments." : "Attention shows all departments."}</p>
}
