"use client"

import Link from "next/link"
import { useEffect, useState, useTransition } from "react"

import { Field } from "@/components/field"
import { Input } from "@/components/ui/input"
import { resetPassword } from "@/lib/auth-client"
import { resetStep } from "@/lib/auth-flow"
import { stripQueryFromAddressBar } from "@/lib/strip-token"
import { PASSWORD_RULES, passwordScore } from "../schemas"

type State = { kind: "form" } | { kind: "done" } | { kind: "expired"; message: string }

// /reset-password?token=...: choose a new password. The token is kept in memory and removed from the address bar on mount (history, screenshots, Referer),
// and goes only in the POST body. A bad, used or expired token is ONE message with a link to ask for a new one. Other sessions are ended by the API.
export function ResetPassword({ token }: { token: string }) {
  const [held] = useState(token)
  const [state, setState] = useState<State>(token ? { kind: "form" } : { kind: "expired", message: "This link is not valid or has expired. Ask for a new one." })
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [pending, start] = useTransition()

  useEffect(() => {
    if (token) stripQueryFromAddressBar()
  }, [token])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (passwordScore(password) !== PASSWORD_RULES.length) return setErrors({ password: "Password needs to meet every rule listed below" })
    if (password !== confirm) return setErrors({ confirm: "The two passwords differ" })
    start(async () => {
      const r = await resetStep({ resetPassword }, held, password)
      setPassword("")
      setConfirm("")
      if (r.ok) return setState({ kind: "done" })
      if ("expired" in r) return setState({ kind: "expired", message: r.message })
      setErrors({ password: r.message })
    })
  }

  if (state.kind === "done")
    return (
      <div className="auth-form" role="status">
        <header className="auth-head">
          <h1>Password updated</h1>
          <p>Your password is changed and your other sessions are signed out. Sign in with the new one.</p>
        </header>
        <Link href="/sign-in" className="btn btn-primary auth-submit">Sign in</Link>
      </div>
    )

  if (state.kind === "expired")
    return (
      <div className="auth-form" role="alert">
        <header className="auth-head">
          <h1>Link expired</h1>
          <p>{state.message}</p>
        </header>
        <Link href="/forgot-password" className="btn btn-primary auth-submit">Send a new link</Link>
        <Link href="/sign-in" className="auth-link">Back to sign in</Link>
      </div>
    )

  const score = passwordScore(password)
  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <header className="auth-head">
        <h1>Reset password</h1>
        <p>Choose a new password for your account.</p>
      </header>
      <Field label="New password" htmlFor="rp-password" error={errors.password} required>
        <Input id="rp-password" type="password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setErrors({}) }} />
      </Field>
      <div className="auth-strength">
        <div suppressHydrationWarning className="progress" role="progressbar" aria-label="Password strength" aria-valuemin={0} aria-valuemax={PASSWORD_RULES.length} aria-valuenow={score} data-score={score}>
          <i style={{ transform: `scaleX(${score / PASSWORD_RULES.length})` }} />
        </div>
        <ul className="auth-rules" aria-label="Password rules">
          {PASSWORD_RULES.map((r) => {
            const ok = r.test(password)
            return (
              <li key={r.id} data-ok={ok ? "" : undefined}>
                <span aria-hidden="true">{ok ? "✓" : "○"}</span> {r.label}
                <span className="sr-only">{ok ? " (met)" : " (not met)"}</span>
              </li>
            )
          })}
        </ul>
      </div>
      <Field label="Confirm password" htmlFor="rp-confirm" error={errors.confirm} required>
        <Input id="rp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setErrors({}) }} />
      </Field>
      <button type="submit" className="btn btn-primary auth-submit" disabled={pending}>
        {pending ? "Saving…" : "Set new password"}
      </button>
    </form>
  )
}
