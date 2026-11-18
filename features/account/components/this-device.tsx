"use client"

import { useRef, useState } from "react"
import { toast } from "sonner"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icon"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import { makeCodeAttempts } from "../adapters"
import { makeAccountClient } from "../client"
import type { OwnDevice } from "../types"

// "This device" (CR-02, R28): which registered device this browser is, and "Enter code" to bind it with a one-time code an admin gave you. The code is typed here,
// sent once and forgotten (never stored, logged or put in a URL). The chip, and Drive, follow the API's next answer (the page refreshes after a bind).
export function ThisDevice({ label, registered, devices }: { label: string; registered: boolean; devices: OwnDevice[] }) {
  const run = useApiAction()
  const account = makeAccountClient(apiBrowser)
  const attempts = useRef(makeCodeAttempts())
  const [open, setOpen] = useState(0)
  const [deviceId, setDeviceId] = useState(devices[0]?.id ?? "")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string>()
  const [locked, setLocked] = useState(false)
  const canBind = !registered && devices.length > 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (attempts.current.locked() || !deviceId || !code.trim()) return
    // The API answers a wrong, expired or used code the same way (no oracle); the failure is shown as one generic message by the runner.
    const r = await run("bind-device", () => account.bindDevice(deviceId, code), { rollback: () => undefined })
    setCode("")
    attempts.current.record(r.ok)
    if (r.ok) {
      toast.success("This device is set up")
      setOpen(0)
      return
    }
    if (attempts.current.locked()) {
      setLocked(true)
      setError(attempts.current.message())
    } else setError("That code didn't work. Check it, or ask for a new one.")
  }

  return (
    <section className="card set-card" aria-labelledby="acc-dev-h">
      <div className="card-head">
        <div>
          <h2 id="acc-dev-h">This device</h2>
          <div className="sub">{label}{registered ? "" : canBind ? ". Enter the code an admin gave you to set it up." : ""}</div>
        </div>
        {canBind && (
          <button type="button" className="btn btn-outline set-sm" onClick={() => { setError(undefined); setOpen((n) => n + 1) }}>
            <Icon name="lock" />
            Enter code
          </button>
        )}
      </div>
      {open > 0 && (
        <Dialog open onOpenChange={(o) => !o && setOpen(0)}>
          <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
            <DialogHeader>
              <DialogTitle>Set up this device</DialogTitle>
              <DialogDescription>Type the one-time code from your admin. It works once and expires after 15 minutes.</DialogDescription>
            </DialogHeader>
            <form className="od-form" onSubmit={submit} noValidate>
              {devices.length > 1 && (
                <Field label="Device" htmlFor="dev-pick">
                  <FilterSelect label="Device" value={deviceId} options={devices.map((d) => ({ value: d.id, label: d.label }))} onChange={setDeviceId} />
                </Field>
              )}
              <Field label="Code" htmlFor="dev-code" error={error}>
                <Input id="dev-code" value={code} autoComplete="off" autoCapitalize="characters" spellCheck={false} disabled={locked} onChange={(e) => { setCode(e.target.value); setError(undefined) }} />
              </Field>
              <div className="od-form-foot">
                <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
                <button type="submit" className="btn btn-primary" disabled={locked || !code.trim()}>Set up</button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
