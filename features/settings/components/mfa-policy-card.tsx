"use client"

import { toast } from "sonner"

import { saveMfaPolicy } from "@/app/actions/security"
import { FilterSelect } from "@/components/filter-bar"
import { Switch } from "@/components/ui/switch"
import { describeMfaPolicy } from "@/lib/mfa"
import type { MfaPolicy } from "@/lib/mfa"
import { mfaPolicyStore } from "../store"

const MODES = [
  { value: "off", label: "Optional" },
  { value: "all", label: "Required for everyone" },
  { value: "roles", label: "Required for chosen roles" },
]

// Require two-step verification (FR-M0-04): everyone or chosen roles. A person it applies to who has not set it up sees the setup gate on every page.
export function MfaPolicyCard({ policy, roles, canWrite, scopeKey }: { policy: MfaPolicy; roles: { id: string; label: string }[]; canWrite: boolean; scopeKey: string }) {
  const [stored, setStored] = mfaPolicyStore.useStore(policy, scopeKey)

  async function save(next: MfaPolicy) {
    const r = await saveMfaPolicy(next)
    if (!r.ok) return toast.error("Could not save the rule")
    setStored(() => next)
    toast.success("Two-step rule saved", { description: describeMfaPolicy(next, Object.fromEntries(roles.map((x) => [x.id, x.label]))) })
  }

  return (
    <section className="card set-card" aria-labelledby="set-mfa-h">
      <div className="card-head">
        <div>
          <h2 id="set-mfa-h">Two-step verification</h2>
          <div className="sub">{describeMfaPolicy(stored, Object.fromEntries(roles.map((x) => [x.id, x.label])))}</div>
        </div>
        {canWrite && (
          <div className="od-filters">
            <FilterSelect
              label="Two-step rule"
              value={stored.mode}
              options={MODES}
              onChange={(v) => save({ mode: v as MfaPolicy["mode"], roles: v === "roles" ? stored.roles : [] })}
            />
          </div>
        )}
      </div>
      {stored.mode === "roles" && (
        <div className="dev-roles">
          {roles.map((r) => (
            <label key={r.id} className="set-switch-row">
              <Switch
                checked={stored.roles.includes(r.id)}
                disabled={!canWrite}
                aria-label={`Require for ${r.label}`}
                onCheckedChange={(on) => save({ mode: "roles", roles: on ? [...stored.roles, r.id] : stored.roles.filter((x) => x !== r.id) })}
              />
              {r.label}
            </label>
          ))}
        </div>
      )}
    </section>
  )
}
