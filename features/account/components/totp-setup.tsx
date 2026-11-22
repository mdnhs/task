"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { toast } from "sonner"

import { Field } from "@/components/field"
import { Icon } from "@/components/icon"
import { SecretInput } from "@/components/secret-input"
import { Input } from "@/components/ui/input"
import { enableTotp, verifyTotp } from "@/lib/auth-client"
import { copyText } from "@/lib/clipboard"
import { STEPS, backOf, canFinish, stepNumber, type Step } from "@/lib/mfa-stepper"
import { confirmEnrolment, otpauthHref, startEnrolment } from "../totp-flow"

// Authenticator set-up (FR-M0-03) on Better Auth, as a four-step stepper: 1 confirm the password, 2 add the account to an authenticator app (the secret to type or copy,
// or the otpauth link on a phone; no QR), 3 confirm with a 6-digit code, 4 save the recovery codes (shown once; the person confirms they saved them). The secret and
// codes live only in this component's state: nothing is stored, logged or put in a URL. 2FA turns on when the first code verifies (end of step 3), so Back is offered
// only on steps 2 and 3, and Cancel only before that (step 4 has no way back: the factor is already on and the codes are shown once).
export function TotpSetup({ account, onDone, onCancel, cancelLabel = "Cancel" }: { account: string; onDone(): void; onCancel?: () => void; cancelLabel?: string }) {
  const [step, setStep] = useState<Step>("password")
  const [password, setPassword] = useState("")
  const [secret, setSecret] = useState("")
  const [uri, setUri] = useState("")
  const [codes, setCodes] = useState<string[]>([])
  const [code, setCode] = useState("")
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()
  const heading = useRef<HTMLHeadingElement>(null)
  const first = useRef(true)

  // Move focus to the new step's heading so a keyboard or screen-reader user lands on it (not on the first render).
  useEffect(() => {
    if (first.current) { first.current = false; return }
    heading.current?.focus()
  }, [step])

  function reset() {
    setPassword(""); setSecret(""); setUri(""); setCodes([]); setCode(""); setSaved(false); setError(undefined)
  }
  function begin(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const r = await startEnrolment({ enable: enableTotp, verify: verifyTotp }, password)
      setPassword("")
      if (!r.ok) return setError(r.message)
      setError(undefined)
      setSecret(r.secret)
      setUri(r.uri)
      setCodes(r.backupCodes)
      setStep("scan")
    })
  }
  function verify(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const r = await confirmEnrolment({ enable: enableTotp, verify: verifyTotp }, code)
      if (!r.ok) return setError(r.message)
      setError(undefined)
      setCode("")
      setStep("backup")
    })
  }
  async function copy(text: string, what: string) {
    if (await copyText(text.replace(/\s/g, ""))) toast.success(`${what} copied`)
  }
  function download() {
    const url = URL.createObjectURL(new Blob([`Two-step verification backup codes for ${account}\nEach works once.\n\n${codes.join("\n")}\n`], { type: "text/plain" }))
    const a = document.createElement("a")
    a.href = url
    a.download = "backup-codes.txt"
    a.click()
    URL.revokeObjectURL(url)
  }
  function finish() {
    if (!canFinish(saved)) return
    // The codes were shown once; drop them from memory before handing back.
    reset()
    toast.success("Two-step verification is on", { description: "You're all set." })
    onDone()
  }
  function cancel() {
    reset()
    onCancel?.()
  }
  function goBack() {
    const b = backOf(step)
    if (!b) return
    setError(undefined)
    if (b === "password") { setSecret(""); setUri(""); setCodes([]) }
    setStep(b)
  }

  const current = stepNumber(step)
  const href = otpauthHref(uri)
  const back = backOf(step)
  const showCancel = onCancel && step !== "backup"

  return (
    <div className="mfa-flow">
      <ol className="mfa-stepper" aria-label="Set-up steps">
        {STEPS.map((s, i) => {
          const n = i + 1
          const state = n < current ? "done" : n === current ? "current" : "todo"
          return (
            <li key={s.id} className="mfa-step" data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span className="mfa-step-n" aria-hidden="true">{state === "done" ? <Icon name="check" size={24} /> : n}</span>
              <span className="mfa-step-t"><span className="sr-only">Step {n}: {state === "done" ? "done, " : ""}</span>{s.short}</span>
            </li>
          )
        })}
      </ol>
      <h2 className="mfa-step-h" tabIndex={-1} ref={heading}>{STEPS[current - 1]!.label}</h2>

      {step === "password" && (
        <form className="mfa-steps" onSubmit={begin} noValidate>
          <p>Confirm your password for {account} to start.</p>
          <Field label="Password" htmlFor="mfa-pw" error={error} required>
            <SecretInput noun="password" id="mfa-pw" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(undefined) }} />
          </Field>
          <div className="mfa-foot">
            <button type="submit" className="btn btn-primary" disabled={pending}>Continue</button>
            {showCancel && <button type="button" className="btn btn-outline set-sm" onClick={cancel}>{cancelLabel}</button>}
          </div>
        </form>
      )}

      {step === "scan" && (
        <div className="mfa-steps">
          <p>Add {account} to your authenticator app: type this key, or open the link on your phone.</p>
          <span className="mfa-secret" aria-label="Setup key">{secret}</span>
          <div className="mfa-actions">
            <button type="button" className="btn btn-outline set-sm" onClick={() => copy(secret, "Key")}><Icon name="copy" size={24} /> Copy key</button>
            {href && <a className="btn btn-outline set-sm" href={href}><Icon name="phone" size={24} /> Open in app</a>}
          </div>
          <div className="mfa-foot">
            <button type="button" className="btn btn-primary" onClick={() => { setError(undefined); setStep("code") }}>Next</button>
            {back && <button type="button" className="btn btn-outline set-sm" onClick={goBack}><Icon name="chevron-left" size={24} /> Back</button>}
            {showCancel && <button type="button" className="btn btn-outline set-sm" onClick={cancel}>{cancelLabel}</button>}
          </div>
        </div>
      )}

      {step === "code" && (
        <form className="mfa-steps" onSubmit={verify} noValidate>
          <p>Enter the 6-digit code your authenticator app shows for {account}.</p>
          <Field label="6-digit code" htmlFor="mfa-code" error={error} required>
            <Input
              id="mfa-code"
              className="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/[^\d\s]/g, "")); setError(undefined) }}
            />
          </Field>
          <div className="mfa-foot">
            <button type="submit" className="btn btn-primary" disabled={pending}>Verify and turn on</button>
            {back && <button type="button" className="btn btn-outline set-sm" onClick={goBack}><Icon name="chevron-left" size={24} /> Back</button>}
            {showCancel && <button type="button" className="btn btn-outline set-sm" onClick={cancel}>{cancelLabel}</button>}
          </div>
        </form>
      )}

      {step === "backup" && (
        <div className="mfa-steps">
          <p>Two-step verification is on. Save these backup codes somewhere safe. Each works once if you lose your phone. They are not shown again.</p>
          <ul className="mfa-codes" aria-label="Backup codes">
            {codes.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <div className="mfa-actions">
            <button type="button" className="btn btn-outline set-sm" onClick={() => copy(codes.join("\n"), "Codes")}><Icon name="copy" size={24} /> Copy codes</button>
            <button type="button" className="btn btn-outline set-sm" onClick={download}><Icon name="download" size={24} /> Download</button>
          </div>
          <label className="mfa-confirm">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            <span>I saved my backup codes</span>
          </label>
          <div className="mfa-foot">
            <button type="button" className="btn btn-primary" disabled={!canFinish(saved)} onClick={finish}>Finish</button>
          </div>
        </div>
      )}
    </div>
  )
}
