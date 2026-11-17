"use client"

import Link from "next/link"
import { useState, useTransition } from "react"

import { Field } from "@/components/field"
import { Input } from "@/components/ui/input"
import { resendVerification, verifyEmail } from "@/lib/auth-client"
import { verifyEmailStep } from "@/lib/auth-flow"
import { emailSchema } from "../schemas"

type State = { kind: "ready" } | { kind: "verified" } | { kind: "expired" } | { kind: "error"; message: string }

// /verify-email?token=...: ONE button. Rendering the page calls nothing (a mail scanner or link preview opening the URL must not consume the token);
// only the click verifies. An expired or invalid link offers a new one (the answer never says whether the address exists).
export function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<State>(token ? { kind: "ready" } : { kind: "expired" })
  const [email, setEmail] = useState("")
  const [emailError, setEmailError] = useState("")
  const [resent, setResent] = useState(false)
  const [pending, start] = useTransition()

  function verify() {
    start(async () => {
      const r = await verifyEmailStep({ verifyEmail }, token)
      setState(r.kind === "error" ? { kind: "error", message: r.message } : { kind: r.kind })
    })
  }
  function resend(e: React.FormEvent) {
    e.preventDefault()
    const r = emailSchema.safeParse(email)
    if (!r.success) return setEmailError(r.error.issues[0].message)
    start(async () => {
      await resendVerification(email.trim()).catch(() => {})
      setResent(true)
    })
  }

  if (state.kind === "verified")
    return (
      <div className="auth-form" role="status">
        <header className="auth-head">
          <h1>Email verified</h1>
          <p>Your address is confirmed. Sign in to continue.</p>
        </header>
        <Link href="/sign-in" className="btn btn-primary auth-submit">Sign in</Link>
      </div>
    )

  if (state.kind === "expired")
    return (
      <form className="auth-form" onSubmit={resend} noValidate>
        <header className="auth-head">
          <h1>Link expired</h1>
          <p>This verification link is not valid any more. Get a new one.</p>
        </header>
        {resent ? (
          <div className="auth-notice" role="status">
            <p>If this address needs a link, a new one is on its way.</p>
          </div>
        ) : (
          <>
            <Field label="Work email" htmlFor="ve-email" error={emailError} required>
              <Input id="ve-email" type="email" autoComplete="username" value={email} placeholder="name@company.com" onChange={(e) => { setEmail(e.target.value); setEmailError("") }} />
            </Field>
            <button type="submit" className="btn btn-primary auth-submit" disabled={pending}>{pending ? "Sending…" : "Send a new link"}</button>
          </>
        )}
        <Link href="/sign-in" className="auth-link">Back to sign in</Link>
      </form>
    )

  return (
    <div className="auth-form">
      <header className="auth-head">
        <h1>Verify your email</h1>
        <p>Confirm this address to finish setting up your account.</p>
      </header>
      {state.kind === "error" && <p className="od-field-err" role="alert">{state.message}</p>}
      <button type="button" className="btn btn-primary auth-submit" disabled={pending} onClick={verify}>
        {pending ? "Verifying…" : "Verify"}
      </button>
      <Link href="/sign-in" className="auth-link">Back to sign in</Link>
    </div>
  )
}
