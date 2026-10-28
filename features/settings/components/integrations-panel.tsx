"use client"

import { useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import type { Status } from "@/lib/types"
import { integrationsStore } from "../store"
import type { Integration, IntegrationStatus } from "../types"

const STATUS: Record<IntegrationStatus, Status> = {
  connected: { tone: "ok", label: "Connected" },
  not_connected: { tone: "mute", label: "Not connected" },
  error: { tone: "bad", label: "Error" },
}

// Integrations (§9): Drive, WhatsApp, email sender and transcription, each with status, last event and policy note.
export function IntegrationsPanel({ integrations, today, tzLabel, canWrite, scopeKey }: { integrations: Integration[]; today: string; tzLabel: string; canWrite: boolean; scopeKey: string }) {
  const [stored, setStored] = integrationsStore.useStore(integrations, scopeKey)
  const [confirm, setConfirm] = useState<Integration | null>(null)

  const update = (id: string, status: IntegrationStatus, lastEvent: string) =>
    setStored((p) => p.map((i) => (i.id === id ? { ...i, status, lastEvent, lastEventAt: today } : i)))

  return (
    <section className="card set-card" aria-labelledby="set-int-h">
      <div className="card-head">
        <div>
          <h2 id="set-int-h">Integrations</h2>
          <div className="sub">{stored.filter((i) => i.status === "connected").length} of {stored.length} connected</div>
        </div>
      </div>
      <ul className="set-int-grid">
        {stored.map((i) => (
          <li key={i.id} className="set-int">
            <div className="set-int-top">
              <span className="set-int-ico" aria-hidden="true"><Icon name={i.icon} /></span>
              <div className="set-int-name">
                <h3>{i.name}</h3>
                <StatusPill status={STATUS[i.status]} />
              </div>
            </div>
            <p className="set-int-desc">{i.description}</p>
            <p className="set-int-event">
              <b>Last event:</b> {i.lastEvent}
              {i.lastEventAt && <> · <When iso={i.lastEventAt} today={today} tzLabel={tzLabel} /></>}
            </p>
            <p className="set-int-policy">{i.policy}</p>
            {canWrite && (
              <div className="set-int-foot">
                {i.status === "connected" ? (
                  <button type="button" className="btn btn-outline" onClick={() => setConfirm(i)}>Disconnect</button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      update(i.id, "connected", i.status === "error" ? "Reconnected" : "Connected")
                      toast.success(`${i.name} connected`)
                    }}
                  >
                    {i.status === "error" ? "Reconnect" : "Connect"}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Disconnect ${confirm?.name ?? "integration"}?`}
        text="Features that depend on it stop working until you connect it again. Existing data is kept."
        confirmLabel="Disconnect"
        destructive
        onConfirm={() => {
          if (!confirm) return
          update(confirm.id, "not_connected", "Disconnected")
          toast.success(`${confirm.name} disconnected`)
        }}
      />
    </section>
  )
}
