"use client"

import { AnimatePresence, motion } from "motion/react"

import { useDept } from "@/hooks/use-dept"
import { Icon } from "@/components/icons"
import { layoutTransition, listItem } from "@/lib/motion"
import type { TeamTasksData } from "../types"

const prio = ["", "Low", "Medium", "High"]

export function TeamTasksTable({ data }: { data: TeamTasksData }) {
  const dep = useDept()
  const rows = data.tasks.filter((t) => dep === "all" || t.dept === dep)

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>{data.title}</h2>
          <div className="sub">{dep === "all" ? "Showing all departments" : `Showing ${dep} only`}</div>
        </div>
        <button className="pill-btn">
          <Icon name="plus" />
          Assign Task
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Assignee</th><th>Task</th><th>Dept</th><th>Priority</th><th>Due</th><th>Status</th></tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
            {rows.map((t) => (
              <motion.tr key={t.ref} layout="position" {...listItem} transition={layoutTransition}>
                <td>
                  <div className="pers">
                    <span className={`avatar ${t.avatar}`}>{t.initials}</span>
                    <div><div className="tt">{t.name}</div><div className="tm">{t.role}</div></div>
                  </div>
                </td>
                <td><div className="tt">{t.task}</div><div className="tm num">{t.ref}</div></td>
                <td><span className="dep-tag">{t.dept}</span></td>
                <td>
                  <span className={`prio p${t.priority}`} title={`${prio[t.priority]} priority`}><i /><i /><i /></span>
                </td>
                <td className={`num due ${t.late ? "due-late" : ""}`}>{t.due}{t.late ? " · late" : ""}</td>
                <td><span className={`st ${t.status.tone}`}>{t.status.label}</span></td>
              </motion.tr>
            ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
    </div>
  )
}
