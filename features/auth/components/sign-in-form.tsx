"use client"

import Link from "next/link"
import { useState, useTransition } from "react"

import { afterSignIn } from "@/app/actions/session"
import { Field } from "@/components/field"
import { Input } from "@/components/ui/input"
import { resendVerification, signInEmail, signInSocial, verifyBackupCode, verifyTotp } from "@/lib/auth-client"
import { secondFactorStep, signInStep, type CodeMode } from "@/lib/auth-flow"
import { signInSchema } from "../schemas"
import type { AuthProviders } from "../types"

type Stage = "credentials" | "mfa"

// FR-AUTH-01/04 on Better Auth: credentials, then (only for accounts with two-step verification) a 6-digit code or a recovery code. The session
// cookie is set by the API (httpOnly); afterSignIn() then picks the company and goes to `next` (a same-origin path, validated on the server too).
// One generic message for every credential failure: nothing here says whether the email exists.
export function SignInForm({ providers, next, expired = false }: { providers: AuthProviders; next: string; expired?: boolean }) {
  const [stage, setStage] = useState<Stage>("credentials")
  const [mode, setMode] = useState<CodeMode>("totp")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ text: string; ref?: string } | null>(null)
  const [unverified, setUnverified] = useState(false)
  const [resent, setResent] = useState(false)
  const [pending, start] = useTransition()

  function credentials(e: React.FormEvent) {
    e.preventDefault()
    const r = signInSchema.safeParse({ email, password })
    if (!r.success) {
      const next: Record<string, string> = {}
      for (const i of r.error.issues) next[String(i.path[0])] ??= i.message
      return setErrors(next)
    }
    setErrors({})
    setNotice(null)
    setUnverified(false)
    start(async () => {
      const r = await signInStep({ signInEmail }, { email, password })
      if (r.kind === "mfa") {
        setPassword("")
        setStage("mfa")
        return
      }
      if (r.kind === "unverified") return setUnverified(true)
      if (r.kind === "error") return setNotice({ text: r.message, ref: r.ref })
      setPassword("")
      await afterSignIn(next)
    })
  }

  function second(e: React.FormEvent) {
    e.preventDefault()
    setNotice(null)
    start(async () => {
      const r = await secondFactorStep({ verifyTotp, verifyBackupCode }, mode, code)
      if (!r.ok) return setErrors({ code: r.message })
      setErrors({})
      await afterSignIn(next)
    })
  }

  function resend() {
    start(async () => {
      await resendVerification(email.trim()).catch(() => {}) // the answer never says whether the address exists
      setResent(true)
    })
  }

  function social(provider: "google" | "microsoft") {
    setNotice(null)
    start(async () => {
      try {
        // After the provider the API sends the browser back here: /api/session/tenant picks the company and lands on `next`.
        const { url } = await signInSocial(provider, `/api/session/tenant?next=${encodeURIComponent(next)}`)
        window.location.assign(url)
      } catch {
        setNotice({ text: "Could not start that sign-in. Try again." })
      }
    })
  }

  if (stage === "mfa")
    return (
      <form className="auth-form" onSubmit={second} noValidate>
        <header className="auth-head">
          <h1>Two-step verification</h1>
          <p>{mode === "totp" ? `Enter the 6-digit code from your authenticator app for ${email.trim()}.` : "Enter one of your recovery codes."}</p>
        </header>
        <Field label={mode === "totp" ? "6-digit code" : "Recovery code"} htmlFor="si-code" error={errors.code} required>
          <Input
            id="si-code"
            className={mode === "totp" ? "auth-code" : undefined}
            inputMode={mode === "totp" ? "numeric" : "text"}
            autoComplete="one-time-code"
            maxLength={mode === "totp" ? 7 : 32}
            value={code}
            onChange={(e) => {
              setCode(mode === "totp" ? e.target.value.replace(/[^\d\s]/g, "") : e.target.value)
              setErrors({})
            }}
          />
        </Field>
        <button type="submit" className="btn btn-primary auth-submit" disabled={pending}>
          {pending ? "Verifying…" : "Verify"}
        </button>
        <button type="button" className="auth-link" onClick={() => { setMode(mode === "totp" ? "backup" : "totp"); setCode(""); setErrors({}) }}>
          {mode === "totp" ? "Use a recovery code" : "Use the authenticator app"}
        </button>
        <button type="button" className="auth-link" onClick={() => { setStage("credentials"); setCode(""); setErrors({}); setMode("totp") }}>
          Back to sign in
        </button>
      </form>
    )

  const anySocial = providers.google || providers.microsoft
  return (
    <form className="auth-form" onSubmit={credentials} noValidate>
      <header className="auth-head">
        <h1>Sign in</h1>
        <p>Welcome back. Sign in to your company workspace.</p>
      </header>
      {expired && !notice && (
        <p className="od-field-err" role="status">Your session expired. Sign in again.</p>
      )}
      {anySocial && (
        <>
          <div className="auth-sso">
            {providers.google && (
              <button type="button" className="btn btn-outline" disabled={pending} onClick={() => social("google")}>
                <span className="auth-sso-mark" style={{ color: "#4285f4" }} aria-hidden="true">G</span>
                Continue with Google
              </button>
            )}
            {providers.microsoft && (
              <button type="button" className="btn btn-outline" disabled={pending} onClick={() => social("microsoft")}>
                <span className="auth-sso-mark" style={{ color: "#00a4ef" }} aria-hidden="true">M</span>
                Continue with Microsoft
              </button>
            )}
          </div>
          <p className="auth-or"><span>or use your email</span></p>
        </>
      )}
      <Field label="Work email" htmlFor="si-email" error={errors.email} required>
        <Input id="si-email" type="email" autoComplete="username" value={email} placeholder="name@company.com" onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: "" })) }} />
      </Field>
      <Field label="Password" htmlFor="si-password" error={errors.password} required>
        <Input id="si-password" type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: "" })) }} />
      </Field>
      <div className="auth-row">
        <Link href="/forgot-password" className="auth-link">
          Forgot password?
        </Link>
      </div>
      {notice && (
        <p className="od-field-err" role="alert">
          {notice.text}
          {notice.ref && <small className="auth-ref"> Ref {notice.ref}</small>}
        </p>
      )}
      {unverified && (
        <div className="auth-notice" role="status">
          <h2>Verify your email</h2>
          <p>Open the link we emailed you to finish sign-up, then sign in.</p>
          {resent ? <p>If this address needs one, a new link is on its way.</p> : <button type="button" className="auth-link" disabled={pending} onClick={resend}>Send a new link</button>}
        </div>
      )}
      <button type="submit" className="btn btn-primary auth-submit" disabled={pending}>
        {pending ? "Signing in…" : "Continue"}
      </button>
      <p className="auth-alt">
        New to OpsDesk? <Link href="/sign-up" className="auth-link">Create a company account</Link>
      </p>
    </form>
  )
}
