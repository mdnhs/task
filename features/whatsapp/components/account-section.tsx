"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icon"
import { StatusPill } from "@/components/status-pill"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { CODE_LENGTH, RESEND_SECONDS, canSendCode, canVerify, cleanCode, countdown, enabledKinds, maskPhone, nationalDigits, tickResend } from "../logic"
import { setSelf, setSelfChannel, waStore } from "../store"
import type { WaState } from "../types"

const COUNTRY_DEFAULT = "IE"
/** The mock rejects this one code so the "wrong code" state can be seen. A real check is the API's. */
const WRONG_CODE = "000000"

type Step = "enter" | "code"

// Account -> Notifications -> WhatsApp (MOCK, local state only). Add your number with a clear opt-in, confirm it with a 6-digit code, then choose which kinds reach you where.
// Disabled with a short explanation until an admin turns WhatsApp on. "Reply STOP" is always visible.
export function WhatsAppAccountSection({ initial, scope }: { initial: WaState; scope: string }) {
  const [s] = waStore.useStore(initial, scope)
  const on = s.connection.status === "active"
  const kinds = enabledKinds(s.kinds, s.connection.status)
  const phase = s.self.phase
  const dial = s.countries.find((c) => c.code === s.self.country)?.dial ?? "353"

  return (
    <section className="card set-card wa-acc" aria-labelledby="acc-wa-h" data-off={on ? undefined : ""}>
      <div className="card-head">
        <div>
          <h2 id="acc-wa-h">WhatsApp</h2>
          <div className="sub">Get notifications on your own WhatsApp, only for what is in your scope</div>
        </div>
        {on && phase === "verified" && <StatusPill status={{ tone: "ok", label: "Verified" }} tick={false} />}
      </div>

      {!on ? (
        <div className="wa-note" role="status">
          <span className="wa-note-ico" aria-hidden="true"><Icon name="lock" /></span>
          <p>{s.connection.status === "connecting" ? "WhatsApp is being set up for your workspace. Check back in a moment." : "Your admin has not turned WhatsApp on yet. Once they do, you can add your number here."}</p>
        </div>
      ) : phase === "verified" ? (
        <Verified national={s.self.national ?? ""} dial={dial} />
      ) : (
        <Setup state={s} optedOut={phase === "opted_out"} />
      )}

      {on && (
        <ChannelTable kinds={kinds} channels={s.self.channels} verified={phase === "verified"} />
      )}
      <p className="wa-stop"><Icon name="info" size={16} />Reply STOP to opt out anytime.</p>
    </section>
  )
}

function Verified({ national, dial }: { national: string; dial: string }) {
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <div className="wa-verified">
        <span className="set-int-ico" aria-hidden="true"><Icon name="bubble-chat" /></span>
        <div className="wa-verified-text">
          <span className="tt num">{maskPhone(dial, national)}</span>
          <span className="tm">Notifications go to this number</span>
        </div>
        <button type="button" className="btn btn-outline wa-remove" onClick={() => setConfirm(true)}>Remove number</button>
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Remove your WhatsApp number?"
        text="You stop getting WhatsApp messages. You can add a number again at any time."
        confirmLabel="Remove number"
        destructive
        onConfirm={() => {
          setSelf({ phase: "none", national: null })
          toast.success("WhatsApp number removed")
        }}
      />
    </>
  )
}

function Setup({ state: s, optedOut }: { state: WaState; optedOut: boolean }) {
  const [step, setStep] = useState<Step>("enter")
  const [country, setCountry] = useState(s.countries.some((c) => c.code === s.self.country) ? s.self.country : COUNTRY_DEFAULT)
  const [phone, setPhone] = useState("")
  const [consent, setConsent] = useState(false)
  const [code, setCode] = useState("")
  const [codeError, setCodeError] = useState<string | undefined>()
  const [left, setLeft] = useState(0)
  const dial = s.countries.find((c) => c.code === country)?.dial ?? "353"
  const national = nationalDigits(phone)

  // The resend timer ticks once a second while the code step is open and time is left.
  const counting = step === "code" && left > 0
  useEffect(() => {
    if (!counting) return
    const t = setInterval(() => setLeft(tickResend), 1000)
    return () => clearInterval(t)
  }, [counting])

  const send = () => {
    if (!canSendCode({ national: phone, consent })) return
    setLeft(RESEND_SECONDS)
    setCode("")
    setCodeError(undefined)
    setStep("code")
    toast.success("Code sent", { description: `To ${maskPhone(dial, national)}` })
  }
  const verify = () => {
    if (!canVerify(code)) return
    if (code === WRONG_CODE) {
      setCodeError("That code is not right. Check it and try again.")
      return
    }
    setSelf({ phase: "verified", country, national })
    toast.success("WhatsApp number verified")
  }

  if (step === "code") {
    return (
      <form className="od-form wa-form" onSubmit={(e) => { e.preventDefault(); verify() }} noValidate>
        <p className="wa-lead">We sent a {CODE_LENGTH}-digit code to <b className="num">{maskPhone(dial, national)}</b> on WhatsApp.</p>
        <Field label="Code" htmlFor="wa-code" error={codeError} required>
          <Input
            id="wa-code"
            className="wa-code num"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH}
            placeholder="123456"
            value={code}
            onChange={(e) => { setCode(cleanCode(e.target.value)); setCodeError(undefined) }}
          />
        </Field>
        <div className="wa-actions">
          <button type="submit" className="btn btn-primary" disabled={!canVerify(code)}>Verify</button>
          <button type="button" className="btn btn-outline" disabled={left > 0} onClick={send}>
            {left > 0 ? <>Resend in <span className="num">{countdown(left)}</span></> : "Resend code"}
          </button>
          <button type="button" className="wa-change" onClick={() => setStep("enter")}>Change number</button>
        </div>
        <span className="sr-only" role="status" aria-live="polite">{left > 0 ? `You can resend in ${left} seconds` : "You can resend the code now"}</span>
      </form>
    )
  }

  return (
    <form className="od-form wa-form" onSubmit={(e) => { e.preventDefault(); send() }} noValidate>
      {optedOut && (
        <div className="wa-note" role="status">
          <span className="wa-note-ico" aria-hidden="true"><Icon name="ban" /></span>
          <p>You opted out by replying STOP. Add your number again to get messages.</p>
        </div>
      )}
      <div className="wa-phone-row">
        <Field label="Country" htmlFor="wa-country">
          <FilterSelect label="Country" value={country} onChange={setCountry} options={s.countries.map((c) => ({ value: c.code, label: `${c.name} +${c.dial}` }))} />
        </Field>
        <Field label="WhatsApp number" htmlFor="wa-phone" required>
          <Input id="wa-phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="e.g. 87 123 4567" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d\s()-]/g, ""))} />
        </Field>
      </div>
      <label className="wa-consent" htmlFor="wa-consent">
        <Checkbox id="wa-consent" className="wa-check" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
        <span>I agree to get OpsDesk notifications on this WhatsApp number. I can reply STOP at any time to opt out.</span>
      </label>
      <div className="wa-actions">
        <button type="submit" className="btn btn-primary" disabled={!canSendCode({ national: phone, consent })}>Send code</button>
        {!consent && <span className="tm wa-gate">Tick the box to continue</span>}
      </div>
    </form>
  )
}

function ChannelTable({ kinds, channels, verified }: { kinds: WaState["kinds"]; channels: WaState["self"]["channels"]; verified: boolean }) {
  if (kinds.length === 0) return <p className="tm wa-empty">Your admin has not chosen any notifications for WhatsApp yet.</p>
  return (
    <div className="wa-chan">
      <h3 className="wa-chan-h">Where you hear about each kind</h3>
      <div className="table-wrap">
        <table className="rtable set-table">
          <thead>
            <tr><th>Event</th><th>In-app</th><th>Email</th><th>WhatsApp</th></tr>
          </thead>
          <tbody>
            {kinds.map((k) => {
              const c = channels[k.id] ?? { inApp: true, email: false, whatsapp: false }
              return (
                <tr key={k.id}>
                  <td data-label="Event"><span className="tt">{k.label}</span><span className="tm acc-hint">{k.hint}</span></td>
                  <td data-label="In-app"><Switch checked={c.inApp} disabled={k.locked} aria-label={`${k.label} in-app`} onCheckedChange={(on) => setSelfChannel(k.id, { inApp: on })} /></td>
                  <td data-label="Email"><Switch checked={c.email} disabled={k.locked} aria-label={`${k.label} by email`} onCheckedChange={(on) => setSelfChannel(k.id, { email: on })} /></td>
                  <td data-label="WhatsApp"><Switch checked={verified && c.whatsapp} disabled={!verified} aria-label={`${k.label} on WhatsApp`} onCheckedChange={(on) => setSelfChannel(k.id, { whatsapp: on })} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!verified && <p className="od-field-hint">Verify your number to turn on WhatsApp.</p>}
    </div>
  )
}
