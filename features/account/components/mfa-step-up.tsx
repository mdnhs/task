"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Field } from "@/components/field"
import { Icon } from "@/components/icon"
import { Input } from "@/components/ui/input"
import { verifyBackupCode, verifyTotp } from "@/lib/auth-client"
import { secondFactorStep, type CodeMode } from "@/lib/auth-flow"

// The step-up (R14, MFA challenge): shown instead of every page while this sign-in has not passed its second factor (the API answered 401 mfa_challenge).
// A 6-digit code, or a recovery code; on success this session is MFA-passed and the layout reloads into the workspace.
export function MfaStepUp({ account }: { account: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<CodeMode>("totp")
  const [code, setCode] = useState("")
  const [error, setError] = useState<string>()
  const [pending, start] = useTransition()

  function submit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const r = await secondFactorStep({ verifyTotp, verifyBackupCode }, mode, code)
      if (!r.ok) return setError(r.message)
      setError(undefined)
      router.refresh()
    })
  }

  return (
    <section className="card set-card mfa-gate" aria-labelledby="mfa-step-h">
      <div className="card-head">
        <div>
          <h1 id="mfa-step-h" className="mfa-gate-h"><Icon name="lock" /> Two-step verification</h1>
          <div className="sub">{mode === "totp" ? `Enter the 6-digit code from your authenticator app for ${account}.` : "Enter one of your recovery codes."}</div>
        </div>
      </div>
      <form className="mfa-steps" onSubmit={submit} noValidate>
        <Field label={mode === "totp" ? "6-digit code" : "Recovery code"} htmlFor="mfa-step-code" error={error} required>
          <Input
            id="mfa-step-code"
            className={mode === "totp" ? "mfa-code" : undefined}
            inputMode={mode === "totp" ? "numeric" : "text"}
            autoComplete="one-time-code"
            maxLength={mode === "totp" ? 7 : 32}
            value={code}
            onChange={(e) => { setCode(mode === "totp" ? e.target.value.replace(/[^\d\s]/g, "") : e.target.value); setError(undefined) }}
          />
        </Field>
        <div><button type="submit" className="btn btn-primary" disabled={pending}>Verify</button></div>
        <button type="button" className="auth-link" onClick={() => { setMode(mode === "totp" ? "backup" : "totp"); setCode(""); setError(undefined) }}>
          {mode === "totp" ? "Use a recovery code" : "Use the authenticator app"}
        </button>
      </form>
    </section>
  )
}
