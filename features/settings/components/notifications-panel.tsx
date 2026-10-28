"use client"

import { useMemo, useState } from "react"
import { toast } from "sonner"

import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { formatTime } from "@/components/time-picker"
import { Switch } from "@/components/ui/switch"
import { When } from "@/components/when"
import { notifyClock } from "@/hooks/use-notify-feed"
import { clockAt, nextReminder, reminderSchedule, type DeliveryStatus } from "@/lib/notify"
import { paginate } from "@/lib/paginate"
import { DELIVERY_PAGE_SIZE } from "../constants"
import { notificationsStore } from "../store"
import type { DeliveryRow, NotificationsData } from "../types"

const clock = (deadline: string, minutesBefore: number) => {
  const [h, m] = deadline.split(":").map((n) => parseInt(n, 10))
  const t = (((h * 60 + m - minutesBefore) % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`
}

// Notifications (FR-NOT-02/04): reminder intervals before the deadline, channels per event, sensitive-preview lock.
const STATUS_PILL: Record<DeliveryStatus, { tone: "ok" | "info" | "mute" | "bad" | "warn"; label: string }> = {
  delivered: { tone: "ok", label: "Delivered" },
  sent: { tone: "info", label: "Sent" },
  queued: { tone: "mute", label: "Queued" },
  failed: { tone: "bad", label: "Failed" },
  skipped: { tone: "warn", label: "Skipped" },
}

export function NotificationsPanel({
  data, deadline, tzLabel, today, timezone, log, canWrite, scopeKey,
}: { data: NotificationsData; deadline: string; tzLabel: string; today: string; timezone: string; log: DeliveryRow[]; canWrite: boolean; scopeKey: string }) {
  const [state, setState] = notificationsStore.useStore(data, scopeKey)
  const [mock, setMock] = notifyClock.useStore(null)
  const [channel, setChannel] = useState("all")
  const [status, setStatus] = useState("all")
  const [page, setPage] = useState(1)

  // Next reminder (FR-NOT-02), computed from the live settings and the mock clock.
  const schedule = reminderSchedule({ today, deadline, timezone, tzLabel }, state)
  const next = nextReminder(schedule, mock ? clockAt(today, mock) : today)
  const labelOf = (id: string) => data.channels.find((c) => c.id === id)?.label ?? id

  const filtered = useMemo(() => log.filter((r) => (channel === "all" || r.channel === channel) && (status === "all" || r.status === status)), [log, channel, status])
  const paged = paginate(filtered, page, DELIVERY_PAGE_SIZE)
  const isFiltered = channel !== "all" || status !== "all"
  const reset = (set: (v: string) => void) => (v: string) => {
    set(v)
    setPage(1)
  }
  const intervals = [...state.intervals].sort((a, b) => b - a)
  const spare = state.intervalOptions.filter((o) => !state.intervals.includes(o)).sort((a, b) => b - a)

  return (
    <>
      <section className="card set-card" aria-labelledby="set-rem-h" data-readonly={canWrite ? undefined : ""}>
        <div className="card-head">
          <div>
            <h2 id="set-rem-h">Deadline reminders</h2>
            <div className="sub">Sent before the {formatTime(deadline)} {tzLabel} report deadline</div>
          </div>
        </div>
        <div className="set-chips">
          {intervals.map((m) => (
            <span key={m} className="set-chip">
              <span className="num">{m} min</span>
              <span className="set-chip-at num">{formatTime(clock(deadline, m))} {tzLabel}</span>
              {canWrite && (
                <button
                  type="button"
                  className="set-chip-x"
                  aria-label={`Remove ${m} minute reminder`}
                  onClick={() => {
                    setState((p) => ({ ...p, intervals: p.intervals.filter((x) => x !== m) }))
                    toast.success("Reminder removed", { description: `${m} minutes before the deadline` })
                  }}
                >
                  <Icon name="plus" />
                </button>
              )}
            </span>
          ))}
          {intervals.length === 0 && <span className="tm">No reminders set</span>}
          {canWrite && spare.length > 0 && (
            <div className="od-filters set-add-interval">
              <FilterSelect
                label="Add reminder"
                value=""
                options={[{ value: "", label: "Add reminder" }, ...spare.map((m) => ({ value: String(m), label: `${m} min before` }))]}
                onChange={(v) => {
                  if (!v) return
                  setState((p) => ({ ...p, intervals: [...p.intervals, Number(v)] }))
                  toast.success("Reminder added", { description: `${v} minutes before the deadline` })
                }}
              />
            </div>
          )}
        </div>
        <p className="set-next num" role="status">
          {next
            ? <>Next reminder: <strong>{formatTime(next.reminder.at)} {tzLabel}</strong>{next.tomorrow ? " tomorrow" : ""} ({next.reminder.channels.map(labelOf).join(", ")})</>
            : "No reminders will be sent."}
        </p>
        <div className="od-filters set-clock">
          <FilterSelect
            label="Mock clock"
            value={mock ?? ""}
            options={[{ value: "", label: `Org clock (${formatTime(today.slice(11, 16))})` }, ...schedule.map((r) => ({ value: r.at, label: `${r.kind === "overdue" ? "Overdue" : "Reminder"} at ${formatTime(r.at)}` }))]}
            onChange={(v) => {
              setMock(() => v || null)
              toast.success(v ? `Clock set to ${formatTime(v)} ${tzLabel}` : "Using the org clock", { description: "Due reminders appear in the notification bell." })
            }}
          />
          <span className="tm">Try the schedule: moves the mock clock, nothing is sent.</span>
        </div>
      </section>

      <section className="card set-card" aria-labelledby="set-ch-h" data-readonly={canWrite ? undefined : ""}>
        <div className="card-head">
          <div>
            <h2 id="set-ch-h">Channels</h2>
            <div className="sub">Where each kind of notification is delivered</div>
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
              {state.events.map((e) => (
                <tr key={e.id}>
                  <td data-label="Event"><span className="tt">{e.label}</span></td>
                  {data.channels.map((c) => (
                    <td key={c.id} data-label={c.label}>
                      <Switch
                        checked={!!e.on[c.id]}
                        disabled={!canWrite}
                        aria-label={`${e.label} by ${c.label}`}
                        onCheckedChange={(on) => setState((p) => ({ ...p, events: p.events.map((x) => (x.id === e.id ? { ...x, on: { ...x.on, [c.id]: on } } : x)) }))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card set-card" aria-labelledby="set-priv-h">
        <div className="card-head">
          <div>
            <h2 id="set-priv-h">Previews</h2>
            <div className="sub">What lock screens and message previews may show</div>
          </div>
        </div>
        <label className="set-switch-row set-locked">
          <Switch checked disabled aria-label="Hide sensitive details in previews" />
          <span>Hide sensitive details in previews</span>
          <span className="set-req">Always on</span>
        </label>
        <p className="od-field-hint">Names, amounts and payroll details never appear in notification previews. This protection cannot be turned off.</p>
      </section>
    
      <section className="card set-card" aria-labelledby="set-log-h">
        <div className="card-head">
          <div>
            <h2 id="set-log-h">Delivery log</h2>
            <div className="sub">Every notification, channel by channel, with its delivery status</div>
          </div>
        </div>
        <FilterBar>
          <FilterSelect label="Channel" value={channel} onChange={reset(setChannel)} options={[{ value: "all", label: "All channels" }, ...data.channels.map((c) => ({ value: c.id, label: c.label }))]} />
          <FilterSelect
            label="Status"
            value={status}
            onChange={reset(setStatus)}
            options={[{ value: "all", label: "All statuses" }, ...(Object.keys(STATUS_PILL) as DeliveryStatus[]).map((k) => ({ value: k, label: STATUS_PILL[k].label }))]}
          />
        </FilterBar>
        {paged.rows.length > 0 ? (
          <div className="table-wrap">
            <table className="rtable set-table">
              <thead>
                <tr><th>Time</th><th>Event</th><th>Recipient</th><th>Channel</th><th>Status</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {paged.rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Time" className="num"><When iso={r.at} today={today} tzLabel={tzLabel} /></td>
                    <td data-label="Event"><span className="tt">{r.event}</span></td>
                    <td data-label="Recipient">{r.recipient}</td>
                    <td data-label="Channel">{labelOf(r.channel)}</td>
                    <td data-label="Status"><StatusPill status={STATUS_PILL[r.status]} /></td>
                    <td data-label="Reason">{r.reason ?? <span className="tm">None</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon="bell" title={isFiltered ? "No deliveries match" : "No deliveries yet"} text={isFiltered ? "Try a different channel or status." : "Sent notifications appear here."} />
        )}
        <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Delivery log pages" onPageChange={setPage} />
      </section>
    </>
  )
}
