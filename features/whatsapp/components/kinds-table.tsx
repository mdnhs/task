"use client"

import { toast } from "sonner"

import { FilterBar, FilterSeg } from "@/components/filter-bar"
import { Switch } from "@/components/ui/switch"
import { setKind } from "../store"
import type { WaDelivery, WaKind } from "../types"

const DELIVERY: { value: WaDelivery; label: string }[] = [
  { value: "instant", label: "Instantly" },
  { value: "digest", label: "Digest" },
]

// "What gets sent": one row per notification kind the product has. The switch turns WhatsApp on for that kind (people then choose it for themselves);
// "Who gets it" is the scope rule, so a person only ever hears about items in their own scope.
export function KindsTable({ kinds, canWrite }: { kinds: WaKind[]; canWrite: boolean }) {
  return (
    <>
      <div className="table-wrap">
        <table className="rtable set-table wa-kinds">
          <thead>
            <tr><th>Notification</th><th>Who gets it</th><th>When</th><th>WhatsApp</th></tr>
          </thead>
          <tbody>
            {kinds.map((k) => {
              const frozen = !canWrite || k.locked
              return (
                <tr key={k.id}>
                  <td data-label="Notification">
                    <span className="tt">{k.label}</span>
                    <span className="tm acc-hint">{k.hint}</span>
                  </td>
                  <td data-label="Who gets it"><span className="wa-scope">{k.scope}</span></td>
                  <td data-label="When">
                    <fieldset className="wa-delivery" disabled={frozen || !k.enabled} data-off={!k.enabled || undefined} aria-label={`${k.label}: when to send`}>
                      <FilterBar>
                        <FilterSeg label={`${k.label}: when to send`} value={k.delivery} options={DELIVERY} onChange={(v) => { setKind(k.id, { delivery: v }); toast.success(`${k.label}: ${v === "digest" ? "daily digest" : "sent instantly"}`) }} />
                      </FilterBar>
                    </fieldset>
                  </td>
                  <td data-label="WhatsApp">
                    <span className="wa-switch">
                      <Switch
                        checked={k.enabled}
                        disabled={frozen}
                        aria-label={`${k.label} on WhatsApp`}
                        onCheckedChange={(on) => { setKind(k.id, { enabled: on }); toast.success(`${k.label}: WhatsApp ${on ? "on" : "off"}`) }}
                      />
                      {k.locked && <span className="set-req">Always on</span>}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="od-field-hint">Digest groups a person&apos;s updates into one message a day. Security is always instant.</p>
    </>
  )
}
