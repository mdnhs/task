"use client"

import { toast } from "sonner"

import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import { FilterSeg } from "@/components/filter-bar"
import { Switch } from "@/components/ui/switch"
import { describeMfaPolicy } from "@/lib/mfa"
import type { MfaPolicy } from "@/lib/mfa"
import { makeSettingsClient } from "../client"

// Short FilterSeg labels; the card's subtitle spells the rule out.
const MODES: { value: MfaPolicy["mode"]; label: string }[] = [
  { value: "off", label: "Optional" },
  { value: "all", label: "Everyone" },
  { value: "roles", label: "Chosen roles" },
]

// Require two-step verification (FR-M0-04): everyone or chosen roles. A person it applies to who has not set it up sees the setup gate on every page.
export function MfaPolicyCard({ policy, roles, canWrite }: { policy: MfaPolicy; roles: { id: string; label: string }[]; canWrite: boolean }) {
  const run = useApiAction()
  const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })
  const stored = policy

  async function save(next: MfaPolicy) {
    const r = await run("mfa-policy", () => client.setMfaPolicy(next))
    if (r.ok) toast.success("Two-step rule saved", { description: describeMfaPolicy(next, Object.fromEntries(roles.map((x) => [x.id, x.label]))) })
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
            <FilterSeg
              label="Two-step rule"
              value={stored.mode}
              options={MODES}
              onChange={(v) => save({ mode: v, roles: v === "roles" ? stored.roles : [] })}
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
