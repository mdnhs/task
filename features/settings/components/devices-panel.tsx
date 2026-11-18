"use client"

import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { DataPagination } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { Field } from "@/components/field"
import { FilterSeg, FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icon"
import { StatusPill } from "@/components/status-pill"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { When } from "@/components/when"
import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import { DEVICE_OWNERS, DEVICE_TYPES } from "@/lib/devices"
import type { Device, DeviceOwner, DeviceType } from "@/lib/devices"
import { paginate } from "@/lib/paginate"
import { makeSettingsClient } from "../client"
import { DEVICES_PAGE_SIZE } from "../constants"

export type DeviceUser = { id: string; name: string }

const label = <T extends string>(list: { value: T; label: string }[], v: T) => list.find((o) => o.value === v)?.label ?? v
const schema = z.object({
  label: z.string().trim().min(2, "Enter a name for the device").max(60, "Keep the name under 60 characters"),
  userId: z.string().min(1, "Choose who it is allocated to"),
})

// Device register (CR-02, CR-06, FR-M0-08): one entry per allocated device. Only a trusted company PC counts for Drive.
export function DevicesPanel({ devices, users, today, tzLabel, canWrite }: { devices: Device[]; users: DeviceUser[]; today: string; tzLabel: string; canWrite: boolean }) {
  const run = useApiAction()
  const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(0)
  const [confirm, setConfirm] = useState<Device | null>(null)
  // The one-time enrolment code lives only in this state, only while the dialog is open: never stored, logged or put in a URL.
  const [code, setCode] = useState<{ label: string; code: string; expiresAt: string } | null>(null)
  const stored = devices
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? "Unknown user"
  const rows = [...stored].sort((a, b) => name(a.userId).localeCompare(name(b.userId)) || a.label.localeCompare(b.label))
  const paged = paginate(rows, page, DEVICES_PAGE_SIZE)

  async function issue(d: Device) {
    const r = await run(`code:${d.id}`, () => client.enrolmentCode(d.id))
    if (r.ok) setCode({ label: d.label, code: r.value.code, expiresAt: r.value.expiresAt })
  }

  return (
    <section className="card set-card" aria-labelledby="set-dev-h">
      <div className="card-head">
        <div>
          <h2 id="set-dev-h">Registered devices</h2>
          <div className="sub">{stored.length} {stored.length === 1 ? "device" : "devices"} · {stored.filter((d) => d.trusted && d.type === "pc" && d.owner === "company").length} trusted company PCs</div>
        </div>
        {canWrite && (
          <button type="button" className="btn btn-primary" onClick={() => setAdding((n) => n + 1)}>
            <Icon name="plus" />
            Add device
          </button>
        )}
      </div>
      {paged.rows.length > 0 ? (
        <ul className="set-list">
          {paged.rows.map((d) => (
            <li key={d.id} className="dev-row">
              <span className="dev-ico" aria-hidden="true"><Icon name={d.type === "android" ? "phone" : "gear"} /></span>
              <div className="dev-main">
                <span className="dev-top">
                  <b className="dev-name">{d.label}</b>
                  <StatusPill status={d.owner === "company" ? { tone: "info", label: "Company" } : { tone: "mute", label: "Personal" }} />
                </span>
                <span className="tm">{name(d.userId)} · {label(DEVICE_TYPES, d.type)}{d.lastSeen && <> · Last seen <When iso={d.lastSeen} today={today} tzLabel={tzLabel} /></>}</span>
              </div>
              <label className="dev-trust">
                <Switch
                  checked={d.trusted}
                  disabled={!canWrite}
                  aria-label={`Trusted: ${d.label}`}
                  onCheckedChange={(on) => void run(`trust:${d.id}`, () => client.setTrusted(d.id, on)).then((r) => r.ok && toast.success(on ? "Device marked trusted" : "Device no longer trusted", { description: d.label }))}
                />
                <span>Trusted</span>
              </label>
              {canWrite && (
                <span className="set-actions">
                  <button type="button" className="btn btn-outline set-sm" onClick={() => void issue(d)} aria-label={`Enrolment code for ${d.label}`}>Enrolment code</button>
                  <button type="button" className="btn btn-outline set-sm" onClick={() => setConfirm(d)} aria-label={`Remove ${d.label}`}>Remove</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon="phone" title="No devices registered" text="Add a company PC so its user can open Google Drive features." />
      )}
      <DataPagination page={paged.page} pageCount={paged.pageCount} total={paged.total} from={paged.from} to={paged.to} label="Devices pages" onPageChange={setPage} />
      {adding > 0 && (
        <AddDeviceDialog
          key={adding}
          users={users}
          onClose={() => setAdding(0)}
          onAdd={async (d) => {
            const r = await run("device:new", () => client.registerDevice(d))
            if (r.ok) toast.success("Device added", { description: d.label })
            return r.ok
          }}
        />
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Remove ${confirm?.label ?? "device"}?`}
        text="It stops counting as a registered device. Features limited to trusted company PCs are no longer available on it."
        confirmLabel="Remove"
        destructive
        onConfirm={() => confirm && void run(`remove:${confirm.id}`, () => client.removeDevice(confirm.id)).then((r) => r.ok && toast.success("Device removed", { description: confirm.label }))}
      />
      <Dialog open={!!code} onOpenChange={(o) => !o && setCode(null)}>
        <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Enrolment code</DialogTitle>
            <DialogDescription>Give this code to the person {code ? `using ${code.label}` : ""}. It works once, expires in 15 minutes, and any current setup of the device is cleared. It is not shown again.</DialogDescription>
          </DialogHeader>
          <p className="num" style={{ fontSize: 22, letterSpacing: 2, fontWeight: 700 }} aria-live="polite">{code?.code}</p>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-primary" />}>Done</DialogClose>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}

// Short FilterSeg labels; the register rows keep the full DEVICE_TYPES labels.
const SHORT_TYPE: Record<DeviceType, string> = { pc: "PC", android: "Android", browser: "Browser" }

function AddDeviceDialog({ users, onClose, onAdd }: { users: DeviceUser[]; onClose(): void; onAdd(d: Omit<Device, "id" | "lastSeen">): Promise<boolean> }) {
  const [text, setText] = useState("")
  const [userId, setUserId] = useState("")
  const [type, setType] = useState<DeviceType>("pc")
  const [owner, setOwner] = useState<DeviceOwner>("company")
  const [trusted, setTrusted] = useState(true)
  const [errors, setErrors] = useState<{ label?: string; userId?: string }>({})

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const r = schema.safeParse({ label: text, userId })
    if (!r.success) {
      const next: typeof errors = {}
      for (const i of r.error.issues) next[i.path[0] as keyof typeof errors] ??= i.message
      return setErrors(next)
    }
    if (await onAdd({ label: r.data.label, userId: r.data.userId, type, owner, trusted })) onClose()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Add device</DialogTitle>
          <DialogDescription>Only a trusted company PC can open Google Drive.</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={submit} noValidate>
          <Field label="Name" htmlFor="dev-name" error={errors.label} required>
            <Input id="dev-name" value={text} placeholder="e.g. Front desk PC" onChange={(e) => { setText(e.target.value); setErrors((x) => ({ ...x, label: undefined })) }} />
          </Field>
          <Field label="Allocated to" htmlFor="dev-user" error={errors.userId} required>
            <FilterSelect label="Allocated to" value={userId} options={[{ value: "", label: "Choose a person" }, ...users.map((u) => ({ value: u.id, label: u.name }))]} onChange={(v) => { setUserId(v); setErrors((x) => ({ ...x, userId: undefined })) }} />
          </Field>
          <div className="od-row2">
            <div className="od-field set-seg-field">
              <span className="fs-label">Type</span>
              <FilterSeg<DeviceType> label="Type" value={type} options={DEVICE_TYPES.map((t) => ({ value: t.value, label: SHORT_TYPE[t.value] }))} onChange={setType} />
            </div>
            <div className="od-field set-seg-field">
              <span className="fs-label">Owner</span>
              <FilterSeg<DeviceOwner> label="Owner" value={owner} options={DEVICE_OWNERS} onChange={setOwner} />
            </div>
          </div>
          <label className="set-switch-row">
            <Switch checked={trusted} onCheckedChange={setTrusted} aria-label="Trusted" />
            Trusted device
          </label>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Add device</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
