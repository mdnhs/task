"use client"

import Link from "next/link"
import { useState } from "react"

import { Field } from "@/components/field"
import { Input } from "@/components/ui/input"
import { emailSchema } from "../schemas"

// FR-AUTH-05: request a reset link; the confirmation never reveals whether the account exists.
export function ForgotForm() {
  const [email, setEmail] = useState("")
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const r = emailSchema.safeParse(email)
    if (!r.success) return setError(r.error.issues[0].message)
    setSent(true)
  }

  if (sent)
    return (
      <div className="auth-form" role="status">
        <header className="auth-head">
          <h1>Check your email</h1>
          <p>
            If an account exists for <strong>{email.trim()}</strong>, we sent a link to reset your password. It expires in 60 minutes.
          </p>
        </header>
        <Link href="/sign-in" className="btn btn-primary auth-submit">
          Back to sign in
        </Link>
        <button type="button" className="auth-link" onClick={() => setSent(false)}>
          Use a different email
        </button>
      </div>
    )

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <header className="auth-head">
        <h1>Forgot password</h1>
        <p>Enter your work email and we will send you a reset link.</p>
      </header>
      <Field label="Work email" htmlFor="fp-email" error={error} required>
        <Input id="fp-email" type="email" autoComplete="username" value={email} placeholder="name@company.com" onChange={(e) => { setEmail(e.target.value); setError("") }} />
      </Field>
      <button type="submit" className="btn btn-primary auth-submit">
        Send reset link
      </button>
      <Link href="/sign-in" className="auth-link">
        Back to sign in
      </Link>
    </form>
  )
}
