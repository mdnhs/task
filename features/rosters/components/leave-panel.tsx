"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { cancelLeave, decideLeave } from "@/app/actions/rosters"
import { FormSection } from "@/components/form-section"
import { Icon } from "@/components/icon"
import { StatusPill } from "@/components/status-pill"
import { formatDate } from "@/lib/dates"
import { canCancelLeave, leaveKindLabel, toDecide } from "../self-service"
import type { ApiLeave } from "../types"

const TONE = { requested: "warn", approved: "ok", rejected: "bad", cancelled: "mute" } as const
const LABEL = { requested: "Waiting", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" } as const
const span = (l: ApiLeave) => (l.from === l.to ? formatDate(l.from) : `${formatDate(l.from)} to ${formatDate(l.to)}`)

// The person's own leave with its status (cancel while it is still to come), and the leave this caller may decide: the API lists only the people it may decide for (D8), and the caller's OWN
// request never shows Approve or Reject (nobody decides their own). Names come from the people list the API gave this caller; anyone else is "Member".
export function LeavePanel({ mine, queue, names, me, today }: { mine: ApiLeave[]; queue: ApiLeave[]; names: Record<string, string>; me: string; today: string }) {
  const router = useRouter()
  const own = [...mine].filter((l) => l.personId === me).sort((a, b) => b.from.localeCompare(a.from))
  const waiting = toDecide(queue, me)
  const [busy, setBusy] = useState<string | null>(null)
  const once = useRef(false)

  async function run(id: string, call: () => Promise<{ ok: true } | { ok: false; error: { toast: { text: string } | null } }>, done: string) {
    if (once.current) return
    once.current = true
    setBusy(id)
    try {
      const r = await call()
      if (!r.ok) toast.error(r.error.toast?.text ?? "Not saved.")
      else {
        toast.success(done)
        router.refresh()
      }
    } finally {
      once.current = false
      setBusy(null)
    }
  }
  const who = (id: string) => names[id] ?? "Member"

  return (
    <>
      <FormSection icon="clipboard-list" title="My leave" note={own.length ? String(own.length) : undefined}>
        {own.length === 0 ? (
          <p className="rl-empty">No leave requests.</p>
        ) : (
          <ul className="mr-chips">
            {own.map((l) => (
              <li key={l.id} className="mr-chip">
                <span><b>{span(l)}</b> <span className="rl-note">{leaveKindLabel(l.kind)}</span></span>
                <span className="mr-decide">
                  <StatusPill status={{ tone: TONE[l.status], label: LABEL[l.status] }} tick={false} />
                  {canCancelLeave(l, today) && (
                    <button type="button" className="fs-act bad" aria-label={`Cancel leave ${span(l)}`} disabled={busy !== null} onClick={() => void run(l.id, () => cancelLeave(l.id), "Leave cancelled")}>
                      <Icon name="close" size={24} />
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </FormSection>
      {waiting.length > 0 && (
        <FormSection icon="clipboard-list" title="Leave to decide" note={String(waiting.length)}>
          <ul className="mr-chips">
            {waiting.map((l) => (
              <li key={l.id} className="mr-chip">
                <span><b>{who(l.personId)}</b> <span className="rl-note">{span(l)} · {leaveKindLabel(l.kind)}</span></span>
                <span className="mr-decide">
                  <button type="button" className="btn btn-outline mr-btn" aria-label={`Approve ${who(l.personId)}`} disabled={busy !== null} onClick={() => void run(l.id, () => decideLeave(l.id, { decision: "approve" }), "Approved")}>
                    <Icon name="check" size={24} />Approve
                  </button>
                  <button type="button" className="btn btn-outline mr-btn" aria-label={`Reject ${who(l.personId)}`} disabled={busy !== null} onClick={() => void run(l.id, () => decideLeave(l.id, { decision: "reject" }), "Rejected")}>
                    <Icon name="close" size={24} />Reject
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </FormSection>
      )}
    </>
  )
}
