"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { FilterSeg } from "@/components/filter-bar"
import { Switch } from "@/components/ui/switch"
import { readAuto, readReady, writeAuto, writeReady } from "@/lib/today-prefs"
import { prefsStore } from "../store"
import type { NotificationPrefsData } from "../types"

// "15 minutes before" → "15 min" for the FilterSeg (the toast keeps the full label).
const shortLead = (label: string) => label.replace(/ before$/, "").replace(/ minutes?$/, " min").replace(/ hours?$/, " h")

// Personal notification preferences: channel x event switches plus the daily-report reminder lead time.
export function AccountNotificationsPanel({ data, scopeKey, todayUser }: { data: NotificationPrefsData; scopeKey: string; todayUser: string }) {
  const [state, setState] = prefsStore.useStore({ prefs: data.prefs, lead: data.lead }, scopeKey)
  // Today card choices (FR-M1-78) live in this browser (localStorage); read after mount so the server and first client render agree.
  const [auto, setAuto] = useState(true)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reads browser storage once after mount */
    setAuto(readAuto(todayUser))
    setReady(readReady(todayUser))
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [todayUser])

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
            <div className="sub">Before the daily report deadline</div>
          </div>
        </div>
        <div className="od-form set-form">
          <div className="od-field set-seg-field">
            <span className="fs-label">Remind me</span>
            <FilterSeg
              label="Remind me"
              value={state.lead}
              options={data.leadOptions.map((o) => ({ value: o.value, label: <span className="num">{shortLead(o.label)}</span> }))}
              onChange={(v) => {
                setState((p) => ({ ...p, lead: v }))
                toast.success("Reminder time updated", { description: data.leadOptions.find((o) => o.value === v)?.label })
              }}
            />
          </div>
        </div>
      </section>

      <section className="card set-card" aria-labelledby="acc-today-h">
        <div className="card-head">
          <div>
            <h2 id="acc-today-h">Your day</h2>
            <div className="sub">The Today card on your home screen</div>
          </div>
        </div>
        <div className="acc-prefs">
          <label className="acc-pref">
            <span>
              <span className="tt">Show the Today card automatically</span>
              <span className="tm acc-hint">Opens at the top of home on your first visit each working day</span>
            </span>
            <Switch
              checked={auto}
              aria-label="Show the Today card automatically"
              onCheckedChange={(on) => {
                setAuto(on)
                writeAuto(todayUser, on)
                toast.success(`Today card ${on ? "on" : "off"}`)
              }}
            />
          </label>
          <label className="acc-pref">
            <span>
              <span className="tt">Send &quot;Your day is ready&quot;</span>
              <span className="tm acc-hint">Mobile push at shift start. Not on leave or days off.</span>
            </span>
            <Switch
              checked={ready}
              aria-label="Send Your day is ready at shift start"
              onCheckedChange={(on) => {
                setReady(on)
                writeReady(todayUser, on)
                toast.success(`"Your day is ready" ${on ? "on" : "off"}`)
              }}
            />
          </label>
        </div>
      </section>
    </>
  )
}
