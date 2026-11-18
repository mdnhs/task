"use client"

import { useState } from "react"
import Link from "next/link"

import { Icon, type IconName } from "@/components/icon"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import type { Status } from "@/lib/types"
import { WA_DESCRIPTION, WA_HINT, WA_MANAGE_HREF } from "../constants"
import { connectedCount } from "../logic"
import { startConnect, stopConnect, waStore } from "../store"
import type { WaConnectionStatus, WaState } from "../types"


export const WA_STATUS: Record<WaConnectionStatus, Status> = {
  not_connected: { tone: "mute", label: "Not connected" },
  connecting: { tone: "info", label: "Connecting" },
  active: { tone: "ok", label: "Active" },
}

/** The three things an admin must know before turning it on (the same three the dialog shows). */
export const WA_POINTS: { icon: IconName; title: string; text: (number: string) => string }[] = [
  { icon: "verified", title: "A verified business number", text: (n) => `Messages come from ${n}, never from a personal phone.` },
  { icon: "check-circle", title: "People opt in", text: () => "Only people who add their number and agree get messages. Reply STOP opts out." },
  { icon: "note-pen", title: "Approved templates", text: () => "Every message uses a pre-approved template. No free text, no personal details." },
]

/** "N of M connected" in the Integrations header: the API's integrations plus WhatsApp. Reads the same store as the card, so turning it on updates the header. */
export function WhatsAppCount({ initial, scope, base, total }: { initial: WaState; scope: string; base: number; total: number }) {
  const [s] = waStore.useStore(initial, scope)
  return <>{connectedCount(base, s.connection.status)} of {total} connected</>
}

/** The WhatsApp card in the Integrations grid: same structure as the Google Drive card. */
export function WhatsAppCard({ initial, scope, today, tzLabel, canWrite }: { initial: WaState; scope: string; today: string; tzLabel: string; canWrite: boolean }) {
  const [s] = waStore.useStore(initial, scope)
  const [open, setOpen] = useState(false)
  const c = s.connection
  const active = c.status === "active"
  return (
    <li className="set-int wa-int" data-status={c.status}>
      <div className="set-int-top">
        <span className="set-int-ico" aria-hidden="true"><Icon name="bubble-chat" /></span>
        <div className="set-int-name">
          <h3>WhatsApp</h3>
          <StatusPill status={WA_STATUS[c.status]} tick={false} />
        </div>
      </div>
      <p className="set-int-desc">{WA_DESCRIPTION}</p>
      {active && (
        <div className="wa-active">
          <p className="wa-number"><span>Sending number</span><b className="num">{c.number}</b></p>
          <dl className="wa-counts" aria-label="Messages today">
            <div className="wa-count"><dt>Sent</dt><dd className="num">{c.today.sent}</dd></div>
            <div className="wa-count"><dt>Delivered</dt><dd className="num">{c.today.delivered}</dd></div>
            <div className="wa-count" data-bad={c.today.failed > 0 || undefined}><dt>Failed</dt><dd className="num">{c.today.failed}</dd></div>
          </dl>
        </div>
      )}
      <p className="set-int-event">
        <b>Last event:</b> {c.lastEvent}
        {c.lastEventAt && <> · <When iso={c.lastEventAt} today={today} tzLabel={tzLabel} /></>}
      </p>
      <p className="set-int-policy">{WA_HINT}</p>
      <div className="set-int-foot">
        {active ? (
          <Link href={WA_MANAGE_HREF} className="btn btn-primary">Manage</Link>
        ) : canWrite ? (
          <button type="button" className="btn btn-primary" disabled={c.status === "connecting"} onClick={() => setOpen(true)}>
            {c.status === "connecting" ? <><Icon name="spinner" className="wa-spin" />Connecting</> : "Turn on"}
          </button>
        ) : null}
      </div>
      {open && <ConnectDialog connection={c} today={today} onClose={() => setOpen(false)} />}
    </li>
  )
}

const STEPS: { id: WaConnectionStatus; label: string }[] = [
  { id: "not_connected", label: "Not connected" },
  { id: "connecting", label: "Connecting" },
  { id: "active", label: "Active" },
]

/** Explains the 3 things, then walks Not connected -> Connecting -> Active (mocked: the timer lives in the store). */
function ConnectDialog({ connection: c, today, onClose }: { connection: WaState["connection"]; today: string; onClose(): void }) {
  const at = STEPS.findIndex((x) => x.id === c.status)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog wa-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Turn on WhatsApp</DialogTitle>
          <DialogDescription>{WA_DESCRIPTION}</DialogDescription>
        </DialogHeader>
        <ul className="wa-points">
          {WA_POINTS.map((p) => (
            <li key={p.title}>
              <span className="wa-point-ico" aria-hidden="true"><Icon name={p.icon} /></span>
              <div>
                <b>{p.title}</b>
                <span>{p.text(c.number)}</span>
              </div>
            </li>
          ))}
        </ul>
        <ol className="wa-steps" aria-label="Setup steps">
          {STEPS.map((st, i) => (
            <li key={st.id} data-state={i < at ? "done" : i === at ? "now" : "next"} aria-current={i === at ? "step" : undefined}>
              <span className="wa-step-dot" aria-hidden="true">{i < at || c.status === "active" ? <Icon name="check" size={12} /> : c.status === "connecting" && i === at ? <Icon name="spinner" size={12} className="wa-spin" /> : i + 1}</span>
              <span>{st.label}</span>
            </li>
          ))}
        </ol>
        <div className="od-form-foot">
          {c.status === "active" ? (
            <>
              <DialogClose render={<button type="button" className="btn btn-outline" />}>Done</DialogClose>
              <Link href={WA_MANAGE_HREF} className="btn btn-primary">Manage</Link>
            </>
          ) : (
            <>
              <button type="button" className="btn btn-outline" onClick={() => { if (c.status === "connecting") stopConnect(today); onClose() }}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={c.status === "connecting"} onClick={() => startConnect(today)}>
                {c.status === "connecting" ? <><Icon name="spinner" className="wa-spin" />Connecting</> : "Turn on"}
              </button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
