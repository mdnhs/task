"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Field } from "@/components/field"
import { PhoneField } from "@/components/phone-field"
import { Icon } from "@/components/icon"
import { StatusPill } from "@/components/status-pill"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { CODE_LENGTH, RESEND_SECONDS, canSendCode, canVerify, cleanCode, countdown, enabledKinds, maskPhone, nationalDigits, resolveVia, tickResend, viaHasEmail } from "../logic"
import { setSelf, setSelfChannel, waStore } from "../store"
import type { PhoneValue } from "@/lib/phone"
import { consumeStaged, stagedStore } from "@/lib/wa-staged"
import { WA_PERSON_STATUS } from "@/lib/wa-status"
import type { WaState, WaVia } from "../types"

const COUNTRY_DEFAULT = "IE"
/** The mock rejects this one code so the "wrong code" state can be seen. A real check is the API's. */
const WRONG_CODE = "000000"

type Step = "enter" | "code"

// Account -> Notifications -> WhatsApp (MOCK, local state only). Add your number with a clear opt-in, confirm it with a 6-digit code, then choose which kinds reach you where.
// Disabled with a short explanation until an admin turns WhatsApp on. "Reply STOP" is always visible.
export function WhatsAppAccountSection({ initial, scope, email }: { initial: WaState; scope: string; email: string }) {
  const [s] = waStore.useStore(initial, scope)
  const [staged] = stagedStore.useStore({}, scope)
  const mine = staged[email.trim().toLowerCase()] ?? null
  const on = s.connection.status === "active" && s.plan.whatsapp
  const kinds = enabledKinds(s.kinds, s.connection.status, s.defaultVia, s.plan)
  // A number the owner typed (or changed) is waiting for the person: they confirm it themselves, whatever their earlier state.
  const phase = mine ? "none" : s.self.phase
  const dial = s.countries.find((c) => c.code === s.self.country)?.dial ?? "353"

  return (
    <section className="card set-card wa-acc" aria-labelledby="acc-wa-h" data-off={on ? undefined : ""}>
      <div className="card-head">
        <div>
          <h2 id="acc-wa-h">WhatsApp</h2>
          <div className="sub">Get notifications on your own WhatsApp, only for what is in your scope</div>
        </div>
        {on && phase === "verified" && <StatusPill status={{ tone: "ok", label: "Verified" }} tick={false} />}
        {on && mine && <StatusPill status={WA_PERSON_STATUS.pending} tick={false} />}
      </div>

      {!on ? (
        <div className="wa-note" role="status">
          <span className="wa-note-ico" aria-hidden="true"><Icon name="lock" /></span>
          <p>{!s.plan.whatsapp ? "WhatsApp is not in your workspace plan." : s.connection.status === "connecting" ? "WhatsApp is being set up for your workspace. Check back in a moment." : "Your admin has not turned WhatsApp on yet. Once they do, you can add your number here."}</p>
        </div>
      ) : phase === "verified" ? (
        <Verified national={s.self.national ?? ""} dial={dial} />
      ) : (
        <Setup key={mine ? `staged-${mine.country}-${mine.national}` : "own"} state={s} optedOut={phase === "opted_out"} staged={mine} email={email} />
      )}

      {on && (
        <ChannelTable kinds={kinds} defaultVia={s.defaultVia} channels={s.self.channels} verified={phase === "verified"} />
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

function Setup({ state: s, optedOut, staged, email }: { state: WaState; optedOut: boolean; staged: PhoneValue | null; email: string }) {
  const [step, setStep] = useState<Step>("enter")
  const [country, setCountry] = useState(staged?.country ?? (s.countries.some((c) => c.code === s.self.country) ? s.self.country : COUNTRY_DEFAULT))
  const [phone, setPhone] = useState(staged?.national ?? "")
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
    if (!canSendCode({ dial, national: phone, consent })) return
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
    consumeStaged(email)
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
      {staged && (
        <div className="wa-note" role="status">
          <span className="wa-note-ico" aria-hidden="true"><Icon name="info" /></span>
          <p>Your admin added this number. Confirm it to start getting messages. Nothing is sent before you do.</p>
        </div>
      )}
      <PhoneField id="wa" countries={s.countries} value={{ country, national: phone }} onChange={(v) => { setCountry(v.country); setPhone(v.national) }} required />
      {staged && <p className="od-field-hint wa-edit-hint">Not your number? Change it here, or ask your admin.</p>}
      <label className="wa-consent" htmlFor="wa-consent">
        <Checkbox id="wa-consent" className="wa-check" checked={consent} onCheckedChange={(v) => setConsent(v === true)} />
        <span>I agree to get OpsDesk notifications on this WhatsApp number. I can reply STOP at any time to opt out.</span>
      </label>
      <div className="wa-actions">
        <button type="submit" className="btn btn-primary" disabled={!canSendCode({ dial, national: phone, consent })}>Send code</button>
        {!consent && <span className="tm wa-gate">Tick the box to continue</span>}
      </div>
    </form>
  )
}

// Per-person choices stay inside what the owner allows: a person can turn a kind off, but a channel the owner switched off for that kind is locked off.
function ChannelTable({ kinds, defaultVia, channels, verified }: { kinds: WaState["kinds"]; defaultVia: WaVia; channels: WaState["self"]["channels"]; verified: boolean }) {
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
              const via = resolveVia(k, defaultVia)
              const mailOk = viaHasEmail(via)
              return (
                <tr key={k.id}>
                  <td data-label="Event"><span className="tt">{k.label}</span><span className="tm acc-hint">{k.hint}</span></td>
                  <td data-label="In-app"><Switch checked={c.inApp} disabled={k.locked} aria-label={`${k.label} in-app`} onCheckedChange={(on) => setSelfChannel(k.id, { inApp: on })} /></td>
                  <td data-label="Email"><Switch checked={mailOk && c.email} disabled={k.locked || !mailOk} aria-label={`${k.label} by email${mailOk ? "" : " (off, set by your admin)"}`} onCheckedChange={(on) => setSelfChannel(k.id, { email: on })} /></td>
                  <td data-label="WhatsApp"><Switch checked={verified && c.whatsapp} disabled={!verified} aria-label={`${k.label} on WhatsApp`} onCheckedChange={(on) => setSelfChannel(k.id, { whatsapp: on })} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="od-field-hint">{verified ? "A switch is locked when your admin has not allowed that channel." : "Verify your number to turn on WhatsApp."}</p>
    </div>
  )
}
