"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Icon, iconName } from "@/components/icon"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import type { Status } from "@/lib/types"
import { makeSettingsClient } from "../client"
import type { Integration, IntegrationStatus } from "../types"

const STATUS: Record<IntegrationStatus, Status> = {
  connected: { tone: "ok", label: "Connected" },
  not_connected: { tone: "mute", label: "Not connected" },
  error: { tone: "bad", label: "Error" },
}

// Integrations (GET /v1/integrations): Google Drive is the only one the API has. "Connect" asks the API for the consent URL and follows it (only on Google's own host);
// Google sends the person back to /settings/integrations?status=connected|error, shown once as a toast. "Disconnect" revokes at Google and erases the stored tokens.
export function IntegrationsPanel({ integrations, flash, today, tzLabel, canWrite }: { integrations: Integration[]; flash?: { status: "connected" | "error" }; today: string; tzLabel: string; canWrite: boolean }) {
  const run = useApiAction()
  const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })
  const [confirm, setConfirm] = useState<Integration | null>(null)
  const stored = integrations.length > 0 ? integrations : [{ id: "google", name: "Google Drive", icon: "folder", status: "not_connected" as const, account: null, description: "Opens Drive files from tasks and reports. Read-only.", lastEvent: "Never connected", lastEventAt: null, policy: "Drive links only open on devices your policy allows." }]

  // The landing page of the Google callback carries only a short status; say it once and clean the address bar.
  useEffect(() => {
    if (!flash) return
    if (flash.status === "connected") toast.success("Google Drive connected")
    else toast.error("Google Drive could not be connected. Try again.")
    window.history.replaceState(null, "", "/settings/integrations")
  }, [flash])

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
              <span className="set-int-ico" aria-hidden="true"><Icon name={iconName(i.icon)} /></span>
              <div className="set-int-name">
                <h3>{i.name}</h3>
                <StatusPill status={STATUS[i.status]} />
              </div>
            </div>
            <p className="set-int-desc">{i.description}</p>
            <p className="set-int-event">
              <b>Last event:</b> {i.lastEvent}{i.account && <> · {i.account}</>}
              {i.lastEventAt && <> · <When iso={i.lastEventAt} today={today} tzLabel={tzLabel} /></>}
            </p>
            <p className="set-int-policy">{i.policy}</p>
            {canWrite && (
              <div className="set-int-foot">
                {i.status === "connected" ? (
                  <button type="button" className="btn btn-outline" onClick={() => setConfirm(i)}>Disconnect</button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={() => void run("google-start", () => client.startGoogle())}>
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
          const c = confirm
          void run(`disc:${c.id}`, () => client.disconnect(c.id)).then((r) => r.ok && toast.success(`${c.name} disconnected`))
        }}
      />
    </section>
  )
}
