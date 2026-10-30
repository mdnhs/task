"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"

import { finishMfaSetup, verifyMfaCode } from "@/app/actions/security"
import { Field } from "@/components/field"
import { Input } from "@/components/ui/input"
import { MOCK_TOTP_CODE, MOCK_TOTP_SECRET, RECOVERY_CODES, qrPattern } from "@/lib/mfa"

const N = 25
const PATTERN = qrPattern(MOCK_TOTP_SECRET, N)

// Mock authenticator setup (FR-M0-03): QR placeholder + secret, a 6-digit check, then recovery codes.
export function TotpSetup({ account, onDone }: { account: string; onDone(): void }) {
  const [step, setStep] = useState<"scan" | "codes">("scan")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()

  function verify(e: React.FormEvent) {
    e.preventDefault()
    if (!/^\d{6}$/.test(code.replace(/\s/g, ""))) return setError("Enter the 6-digit code")
    start(async () => {
      const r = await verifyMfaCode(code)
      if (!r.ok) return setError("That code is not right. Check your authenticator app and try again.")
      setError(undefined)
      setStep("codes")
    })
  }
  function finish() {
    start(async () => {
      const r = await finishMfaSetup()
      if (!r.ok) {
        toast.error("Could not finish setup. Try again.")
        return
      }
      toast.success("Two-step verification on")
      onDone()
    })
  }

  if (step === "codes")
    return (
      <div className="mfa-steps">
        <p>Save these recovery codes somewhere safe. Each works once if you lose your phone.</p>
        <ul className="mfa-codes" aria-label="Recovery codes">
          {RECOVERY_CODES.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={finish}>I saved my codes</button>
      </div>
    )

  return (
    <form className="mfa-setup" onSubmit={verify} noValidate>
      <div className="mfa-qr" role="img" aria-label="Placeholder for the authenticator QR code">
        <svg viewBox={`0 0 ${N} ${N}`} shapeRendering="crispEdges" aria-hidden="true">
          {PATTERN.flatMap((row, y) => row.map((on, x) => (on ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" /> : null)))}
        </svg>
      </div>
      <div className="mfa-steps">
        <p>Scan in your authenticator app for {account}, or type this key:</p>
        <span className="mfa-secret">{MOCK_TOTP_SECRET}</span>
        <Field label="6-digit code" htmlFor="mfa-code" error={error} hint={`Demo: the code is ${MOCK_TOTP_CODE}.`} required>
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
