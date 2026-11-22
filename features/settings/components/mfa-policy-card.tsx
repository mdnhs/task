"use client"

import { useState } from "react"
import { toast } from "sonner"

import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import { FilterSeg } from "@/components/filter-bar"
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Switch } from "@/components/ui/switch"
import { describeMfaPolicy } from "@/lib/mfa"
import type { MfaEnforcement, MfaPolicy } from "@/lib/mfa"
import { enforcementOf, enforcementText, needsStrictConfirm, withEnforcement, withMode, withRoles } from "@/lib/mfa-enforcement"
import { makeSettingsClient } from "../client"

// Short FilterSeg labels; the card's subtitle spells the rule out.
const MODES: { value: MfaPolicy["mode"]; label: string }[] = [
  { value: "off", label: "Optional" },
  { value: "all", label: "Everyone" },
  { value: "roles", label: "Chosen roles" },
]
const HOW: { value: MfaEnforcement; label: string }[] = [
  { value: "prompt", label: "Soft prompt" },
  { value: "strict", label: "Strict" },
]

// Require two-step verification (FR-M0-04): everyone or chosen roles. How hard it is enforced is the owner's choice: a soft prompt (default: a reminder, the app keeps
// working) or strict (a person who has not set it up is blocked until they do). Only people who can write settings see the controls.
export function MfaPolicyCard({ policy, roles, canWrite }: { policy: MfaPolicy; roles: { id: string; label: string }[]; canWrite: boolean }) {
  const run = useApiAction()
  const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })
  const stored = policy
  const [confirmStrict, setConfirmStrict] = useState(false)
  const how = enforcementOf(stored)
  const labels = Object.fromEntries(roles.map((x) => [x.id, x.label]))

  async function save(next: MfaPolicy) {
    const r = await run("mfa-policy", () => client.setMfaPolicy(next))
    if (r.ok) toast.success("Two-step rule saved", { description: `${describeMfaPolicy(next, labels)}. ${enforcementText(enforcementOf(next))}` })
    return r.ok
  }
  function chooseHow(v: MfaEnforcement) {
    if (v === how) return
    if (needsStrictConfirm(stored, v)) return setConfirmStrict(true)
    void save(withEnforcement(stored, v))
  }

  return (
    <section className="card set-card" aria-labelledby="set-mfa-h">
      <div className="card-head">
        <div>
          <h2 id="set-mfa-h">Two-step verification</h2>
          <div className="sub">{describeMfaPolicy(stored, labels)}</div>
        </div>
        {canWrite && (
          <div className="od-filters">
            <FilterSeg label="Two-step rule" value={stored.mode} options={MODES} onChange={(v) => save(withMode(stored, v))} />
          </div>
        )}
      </div>
      {stored.mode !== "off" && (
        <div className="mfa-enf">
          <p className="mfa-enf-t">{enforcementText(how)}</p>
          {canWrite && <FilterSeg label="How strictly" value={how} options={HOW} onChange={chooseHow} />}
        </div>
      )}
      {stored.mode === "roles" && (
        <div className="dev-roles">
          {roles.map((r) => (
            <label key={r.id} className="set-switch-row">
              <Switch
                checked={stored.roles.includes(r.id)}
                disabled={!canWrite}
                aria-label={`Require for ${r.label}`}
                onCheckedChange={(on) => save(withRoles(stored, on ? [...stored.roles, r.id] : stored.roles.filter((x) => x !== r.id)))}
              />
              {r.label}
            </label>
          ))}
        </div>
      )}
      <AlertDialog open={confirmStrict} onOpenChange={setConfirmStrict}>
        <AlertDialogContent className="od-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Block people who have not set it up?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone this rule applies to who has not set up two-step verification will be blocked from the workspace until they do. You can switch back to a soft prompt at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <button type="button" className="btn btn-outline" onClick={() => setConfirmStrict(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={async () => { setConfirmStrict(false); await save(withEnforcement(stored, "strict")) }}>Switch to strict</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
