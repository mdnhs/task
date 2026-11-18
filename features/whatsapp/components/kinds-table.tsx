"use client"

import Link from "next/link"
import { toast } from "sonner"

import { FilterBar, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icon"
import { VIA_OPTIONS, resolveVia, usageNote, usagePct, viaLabel } from "../logic"
import { setDefaultVia, setKindVia } from "../store"
import type { WaKind, WaPlan, WaVia } from "../types"

/** The plan's allowance: a note and a usage bar (the shared .progress pattern), or an upgrade hint when the plan has no WhatsApp. */
export function PlanNote({ plan }: { plan: WaPlan }) {
  if (!plan.whatsapp) {
    return (
      <div className="wa-plan wa-plan-off" role="status">
        <Icon name="lock" size={16} />
        <span>WhatsApp is not in your plan. Upgrade to send notifications on WhatsApp.</span>
        <Link href="/settings/billing" className="wa-plan-link">See plans</Link>
      </div>
    )
  }
  const pct = usagePct(plan)
  return (
    <div className="wa-plan" data-warn={pct >= 90 || undefined}>
      <span className="wa-plan-text num">{usageNote(plan)}</span>
      {plan.limit !== null && (
        <div suppressHydrationWarning className="progress" role="progressbar" aria-label="WhatsApp messages used this month" aria-valuemin={0} aria-valuemax={plan.limit} aria-valuenow={plan.used}>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

// "What gets sent": the owner decides, per notification kind, how it is sent: email only, WhatsApp only, both (always allowed, no forced dedupe) or WhatsApp first
// with email when it is not delivered. A tenant-wide default covers the kinds left on "Default". "Who gets it" is the scope rule: a person only hears about items in their scope.
export function KindsTable({ kinds, defaultVia, plan, canWrite }: { kinds: WaKind[]; defaultVia: WaVia; plan: WaPlan; canWrite: boolean }) {
  const open = canWrite && plan.whatsapp
  return (
    <>
      <PlanNote plan={plan} />
      <div className="wa-default">
        <div className="wa-default-text">
          <b>Default for all kinds</b>
          <span className="tm">Used by every kind set to Default.</span>
        </div>
        <span className="wa-via" data-frozen={!open || undefined} inert={!open}>
          <FilterBar>
            <FilterSelect label="Default for all kinds" value={defaultVia} options={VIA_OPTIONS} onChange={(v) => { setDefaultVia(v); toast.success(`Default: ${viaLabel(v)}`) }} />
          </FilterBar>
        </span>
      </div>
      <div className="table-wrap" data-readonly={open ? undefined : ""}>
        <table className="rtable set-table wa-kinds">
          <thead>
            <tr><th>Notification</th><th>Who gets it</th><th>Send via</th></tr>
          </thead>
          <tbody>
            {kinds.map((k) => {
              const frozen = !open || k.locked
              return (
                <tr key={k.id}>
                  <td data-label="Notification">
                    <span className="tt">{k.label}</span>
                    <span className="tm acc-hint">{k.hint}</span>
                  </td>
                  <td data-label="Who gets it"><span className="wa-scope">{k.scope}</span></td>
                  <td data-label="Send via">
                    <span className="wa-via" data-frozen={frozen || undefined} inert={frozen}>
                      <FilterBar>
                        <FilterSelect
                          label={`${k.label}: send via`}
                          value={k.via}
                          options={[{ value: "default", label: `Default (${viaLabel(defaultVia)})` }, ...VIA_OPTIONS]}
                          onChange={(v) => { if (frozen) return; setKindVia(k.id, v as WaKind["via"]); toast.success(`${k.label}: ${viaLabel(resolveVia({ via: v as WaKind["via"] }, defaultVia))}`) }}
                        />
                      </FilterBar>
                      {k.locked && <span className="set-req">Always both</span>}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="od-field-hint">Both always sends on each channel. People can switch a kind off for themselves, but cannot turn on a channel you switched off.</p>
    </>
  )
}
