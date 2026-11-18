"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { Field } from "@/components/field"
import { SecretInput } from "@/components/secret-input"
import { Input } from "@/components/ui/input"
import { enableTotp, verifyTotp } from "@/lib/auth-client"
import { copyText } from "@/lib/clipboard"
import { confirmEnrolment, otpauthHref, startEnrolment } from "../totp-flow"
import { Icon } from "@/components/icon"

type Step = "password" | "scan" | "codes"

// Authenticator set-up (FR-M0-03) on Better Auth: confirm the password, then add the account to an authenticator app (the secret to type or copy, or the
// otpauth link on a phone; no QR), confirm with a 6-digit code, then the recovery codes (shown once). The secret and codes live only in this component's
// state: nothing is stored, logged or put in a URL. 2FA turns on when the first code verifies.
export function TotpSetup({ account, onDone }: { account: string; onDone(): void }) {
  const [step, setStep] = useState<Step>("password")
  const [password, setPassword] = useState("")
  const [secret, setSecret] = useState("")
  const [uri, setUri] = useState("")
  const [codes, setCodes] = useState<string[]>([])
  const [code, setCode] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()

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
      setStep("codes")
    })
  }
  async function copy(text: string) {
    if (await copyText(text.replace(/\s/g, ""))) toast.success("Copied")
  }
  function finish() {
    // The codes were shown once; drop them from memory before handing back.
    setCodes([])
    setSecret("")
    setUri("")
    toast.success("Two-step verification on")
    onDone()
  }

  if (step === "codes")
    return (
      <div className="mfa-steps">
        <p>Save these recovery codes somewhere safe. Each works once if you lose your phone. They are not shown again.</p>
        <ul className="mfa-codes" aria-label="Recovery codes">
          {codes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <button type="button" className="btn btn-primary" onClick={finish}>I saved my codes</button>
      </div>
    )

  if (step === "password")
    return (
      <form className="mfa-steps" onSubmit={begin} noValidate>
        <p>Confirm your password for {account} to start.</p>
        <Field label="Password" htmlFor="mfa-pw" error={error} required>
          <SecretInput noun="password" id="mfa-pw" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(undefined) }} />
        </Field>
        <div><button type="submit" className="btn btn-primary" disabled={pending}>Continue</button></div>
      </form>
    )

  const href = otpauthHref(uri)
  return (
    <form className="mfa-setup mfa-noqr" onSubmit={verify} noValidate>
      <div className="mfa-steps">
        <p>Add {account} to your authenticator app: type this key, or open the link on your phone.</p>
        <span className="mfa-secret" aria-label="Setup key">{secret}</span>
        <div className="mfa-actions">
          <button type="button" className="btn btn-outline set-sm" onClick={() => copy(secret)}><Icon name="copy" size={24} /> Copy key</button>
          {href && <a className="btn btn-outline set-sm" href={href}><Icon name="phone" size={24} /> Open in app</a>}
        </div>
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
        <div><button type="submit" className="btn btn-primary" disabled={pending}>Verify and turn on</button></div>
      </div>
    </form>
  )
}
