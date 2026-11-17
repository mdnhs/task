"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Field } from "@/components/field"
import { TimePicker } from "@/components/time-picker"
import { Switch } from "@/components/ui/switch"
import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import { readAuto, readReady, writeAuto, writeReady } from "@/lib/today-prefs"
import { PREF_CHANNELS, prefsBody, type PrefsChange } from "../adapters"
import { makeAccountClient } from "../client"
import type { PrefChannel, PrefsView } from "../types"

// Personal notification preferences (GET/PUT /v1/me/notification-preferences): a channel matrix per kind, plus quiet hours. Each switch is one write; the page then
// re-reads the server's matrix, so a refused change reverts by construction. `security` always keeps in-app and email (the API refuses to turn them off).
export function AccountNotificationsPanel({ data, todayUser }: { data: PrefsView; todayUser: string }) {
  const run = useApiAction()
  const account = makeAccountClient(apiBrowser)
  const [quiet, setQuiet] = useState(data.quiet ?? { start: "22:00", end: "07:00" })
  // Today card choices (FR-M1-78) live in this browser (localStorage); read after mount so the server and first client render agree.
  const [auto, setAuto] = useState(true)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- reads browser storage once after mount */
    setAuto(readAuto(todayUser))
    setReady(readReady(todayUser))
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [todayUser])

  const save = (change: PrefsChange, ok: string, description?: string) =>
    run("prefs", () => account.savePrefs(prefsBody(data, change))).then((r) => r.ok && toast.success(ok, description ? { description } : undefined))
  const same = quiet.start === quiet.end

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
                {PREF_CHANNELS.map((c) => <th key={c.id}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((e) => (
                <tr key={e.kind}>
                  <td data-label="Event">
                    <span className="tt">{e.label}</span>
                    <span className="tm acc-hint">{e.hint}</span>
                  </td>
                  {PREF_CHANNELS.map((c) => (
                    <td key={c.id} data-label={c.label}>
                      <Switch
                        checked={e[c.id as PrefChannel]}
                        disabled={e.locked && c.id !== "push"}
                        aria-label={`${e.label} by ${c.label}`}
                        onCheckedChange={(on) => void save({ kind: e.kind, channel: c.id, on }, `${e.label}: ${c.label} ${on ? "on" : "off"}`)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card set-card" aria-labelledby="acc-quiet-h">
        <div className="card-head">
          <div>
            <h2 id="acc-quiet-h">Quiet hours</h2>
            <div className="sub">{data.quiet ? `No emails or pushes ${data.quiet.start} to ${data.quiet.end}` : "Off. Emails and pushes can arrive any time"}</div>
          </div>
        </div>
        <form className="od-form set-form" noValidate onSubmit={(e) => { e.preventDefault(); if (!same) void save({ quiet }, "Quiet hours saved", `${quiet.start} to ${quiet.end}`) }}>
          <div className="od-row2">
            <Field label="From" htmlFor="acc-quiet-from">
              <TimePicker value={quiet.start} onChange={(v) => setQuiet((q) => ({ ...q, start: v }))} label="Quiet hours from" step={15} />
            </Field>
            <Field label="Until" htmlFor="acc-quiet-to" error={same ? "Pick two different times." : undefined}>
              <TimePicker value={quiet.end} onChange={(v) => setQuiet((q) => ({ ...q, end: v }))} label="Quiet hours until" step={15} />
            </Field>
          </div>
          <div className="od-form-foot">
            {data.quiet && <button type="button" className="btn btn-outline" onClick={() => void save({ quiet: null }, "Quiet hours off")}>Turn off</button>}
            <button type="submit" className="btn btn-primary" disabled={same}>Save quiet hours</button>
          </div>
        </form>
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
