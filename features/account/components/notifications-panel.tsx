"use client"

import { toast } from "sonner"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Switch } from "@/components/ui/switch"
import { prefsStore } from "../store"
import type { NotificationPrefsData } from "../types"

// Personal notification preferences: channel x event switches plus the daily-report reminder lead time.
export function AccountNotificationsPanel({ data, scopeKey }: { data: NotificationPrefsData; scopeKey: string }) {
  const [state, setState] = prefsStore.useStore({ prefs: data.prefs, lead: data.lead }, scopeKey)

  return (
    <>
      <section className="card set-card" aria-labelledby="acc-ch-h">
        <div className="card-head">
          <div>
            <h2 id="acc-ch-h">Channels</h2>
            <div className="sub">Choose how you hear about each kind of event</div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="rtable set-table">
            <thead>
              <tr>
                <th>Event</th>
                {data.channels.map((c) => <th key={c.id}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.events.map((e) => (
                <tr key={e.id}>
                  <td data-label="Event">
                    <span className="tt">{e.label}</span>
                    <span className="tm acc-hint">{e.hint}</span>
                  </td>
                  {data.channels.map((c) => (
                    <td key={c.id} data-label={c.label}>
                      <Switch
                        checked={!!state.prefs[e.id]?.[c.id]}
                        aria-label={`${e.label} by ${c.label}`}
                        onCheckedChange={(on) => {
                          setState((p) => ({ ...p, prefs: { ...p.prefs, [e.id]: { ...p.prefs[e.id], [c.id]: on } } }))
                          toast.success(`${e.label}: ${c.label} ${on ? "on" : "off"}`)
                        }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card set-card" aria-labelledby="acc-lead-h">
        <div className="card-head">
          <div>
            <h2 id="acc-lead-h">Daily reminder</h2>
            <div className="sub">When the daily report reminder reaches you</div>
          </div>
        </div>
        <div className="od-form set-form">
          <div className="od-row2">
            <Field label="Remind me" htmlFor="acc-lead" hint="Counted back from the report deadline">
              <FilterSelect
                label="Remind me"
                value={state.lead}
                options={data.leadOptions}
                onChange={(v) => {
                  setState((p) => ({ ...p, lead: v }))
                  toast.success("Reminder time updated", { description: data.leadOptions.find((o) => o.value === v)?.label })
                }}
              />
            </Field>
          </div>
        </div>
      </section>
    </>
  )
}
