"use client"

import { Check, ClipboardList, X } from "lucide-react"
import { toast } from "sonner"

import { FormSection } from "@/components/form-section"
import { StatusPill } from "@/components/status-pill"
import { formatDate } from "@/lib/dates"
import type { LeaveRequest } from "@/lib/roster-rules"
import { leaveStore } from "../store"
import { decideLeave } from "../self-service"
import type { LeaveQueue, MyRosterData } from "../types"

const TONE = { requested: "warn", approved: "ok", rejected: "bad" } as const
const LABEL = { requested: "Waiting", approved: "Approved", rejected: "Rejected" } as const
const span = (l: LeaveRequest) => (l.from === l.to ? formatDate(l.from) : `${formatDate(l.from)} to ${formatDate(l.to)}`)

// The person's own requests with their status, and, for roles that can decide (the server only sends them rows they may decide), the queue.
export function LeavePanel({ me, today, scopeKey, data, queue }: { me: string; today: string; scopeKey: string; data: MyRosterData; queue: LeaveQueue }) {
  const [all, setAll] = leaveStore.useStore([...data.leave, ...queue.leave.filter((q) => !data.leave.some((l) => l.id === q.id))], scopeKey)
  const mine = all.filter((l) => l.personId === me).sort((a, b) => b.from.localeCompare(a.from))
  const waiting = all.filter((l) => l.status === "requested" && l.personId !== me && queue.names[l.personId] !== undefined).sort((a, b) => a.from.localeCompare(b.from))
  const stamp = `${today.slice(0, 10)}T${today.slice(11, 16)}:00`

  function decide(l: LeaveRequest, approve: boolean) {
    try {
      setAll((p) => p.map((x) => (x.id === l.id ? decideLeave(x, approve, me, stamp) : x)))
      toast.success(`${queue.names[l.personId] ?? "Request"} ${approve ? "approved" : "rejected"}`)
    } catch {
      toast.error("Already decided")
    }
  }

  return (
    <>
      <FormSection icon={ClipboardList} title="My leave">
        {mine.length === 0 ? (
          <p className="rl-empty">No leave requests.</p>
        ) : (
          <ul className="mr-chips">
            {mine.map((l) => (
              <li key={l.id} className="mr-chip">
                <span><b>{span(l)}</b> <span className="rl-note">{l.kind}</span></span>
                <StatusPill status={{ tone: TONE[l.status], label: LABEL[l.status] }} tick={false} />
              </li>
            ))}
          </ul>
        )}
      </FormSection>
      {(queue.leave.length > 0 || waiting.length > 0) && (
        <FormSection icon={ClipboardList} title="Leave to decide" note={waiting.length ? `${waiting.length}` : undefined}>
          {waiting.length === 0 ? (
            <p className="rl-empty">Nothing waiting.</p>
          ) : (
            <ul className="mr-chips">
              {waiting.map((l) => (
                <li key={l.id} className="mr-chip">
                  <span><b>{queue.names[l.personId]}</b> <span className="rl-note">{span(l)} · {l.kind}</span></span>
                  <span className="mr-decide">
                    <button type="button" className="btn btn-outline mr-btn" aria-label={`Approve ${queue.names[l.personId]}`} onClick={() => decide(l, true)}><Check aria-hidden="true" />Approve</button>
                    <button type="button" className="btn btn-outline mr-btn" aria-label={`Reject ${queue.names[l.personId]}`} onClick={() => decide(l, false)}><X aria-hidden="true" />Reject</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </FormSection>
      )}
    </>
  )
}
