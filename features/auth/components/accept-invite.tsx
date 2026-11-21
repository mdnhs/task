"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { acceptInvite, registerInvite } from "@/app/actions/invite"
import { afterSignIn } from "@/app/actions/session"
import { Field } from "@/components/field"
import { SecretInput } from "@/components/secret-input"
import { Input } from "@/components/ui/input"
import { signInEmail } from "@/lib/auth-client"
import { signInStep, type InviteFailKind } from "@/lib/auth-flow"
import { PASSWORD_RULES, ownerSchema, passwordScore, signInSchema } from "../schemas"
import type { InviteData, InvitePreview } from "../types"

type Fail = { kind: InviteFailKind; message: string }

// /invite?token=...: where the invitation email leads. The page shows what the link is for (company, role, invited address) and needs ONE action:
//  - signed in as the invited address: "Accept invitation";
//  - no account for that address: name + password, one button. The link proves the address, so the account is created verified and joined in one call, then
//    signed in with the same password (no second email, no second tab);
//  - an account already exists: its password, one button (sign in, then accept).
// Rendering calls nothing that uses the invitation (a mail scanner or link preview must not consume it): only the button does.
export function AcceptInvite({ token, data }: { token: string; data: InviteData }) {
  if (data.kind === "unusable") return <Unusable data={data} />
  return <Ready token={token} preview={data.preview} viewer={data.viewer} />
}

function Unusable({ data }: { data: Extract<InviteData, { kind: "unusable" }> }) {
  return (
    <div className="auth-form" role="alert">
      <header className="auth-head">
        <h1>{data.reason === "expired" ? "Invitation expired" : data.reason === "used" ? "Invitation already used" : "Cannot open this invitation"}</h1>
        <p>{data.message}</p>
      </header>
      <Link href="/sign-in" className="btn btn-primary auth-submit">Go to sign in</Link>
    </div>
  )
}

function Ready({ token, preview, viewer }: { token: string; preview: InvitePreview; viewer: string | null }) {
  const [accountExists, setAccountExists] = useState(preview.accountExists)
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [fail, setFail] = useState<Fail | null>(null)
  const [pending, start] = useTransition()
  const router = useRouter()

  const here = `/invite?token=${encodeURIComponent(token)}`
  const signInHref = `/sign-in?next=${encodeURIComponent(here)}`
  const who = preview.invitedBy ? `${preview.invitedBy} invited you` : "You are invited"
  const headline = `Join ${preview.company}`
  const sub = `${who} to join ${preview.company} as ${preview.roleLabel}.`

  // A failure that ends the flow: the reason and the one thing that helps. (account_exists is not one of them: it switches to the sign-in form.)
  const endsFlow = fail && fail.kind !== "rate_limited" && fail.kind !== "error" && fail.kind !== "validation" && fail.kind !== "account_exists"
  const note = fail && !endsFlow ? <p className="od-field-err" role="alert">{fail.message}</p> : null

  function accept() {
    setFail(null)
    start(async () => {
      const r = await acceptInvite(token) // success redirects into the company; only a failure comes back
      if (r) setFail(r)
    })
  }

  // No account yet: create it (verified, joined), sign in with the same password, then go to the company (its only membership is this one).
  function join(e: React.FormEvent) {
    e.preventDefault()
    const r = ownerSchema.safeParse({ name, email: preview.email, password })
    if (!r.success) {
      const next: Record<string, string> = {}
      for (const i of r.error.issues) next[String(i.path[0])] ??= i.message
      return setErrors(next)
    }
    setErrors({})
    setFail(null)
    start(async () => {
      const made = await registerInvite({ token, name, password })
      if (!made.ok) {
        if (made.kind === "account_exists") {
          setAccountExists(true)
          setPassword("")
          return void toast.info("You already have an account. Sign in to join.")
        }
        return setFail(made)
      }
      const s = await signInStep({ signInEmail }, { email: made.email, password })
      setPassword("")
      if (s.kind !== "signed_in") {
        toast.success("Account created. Sign in to continue.")
        router.push(signInHref)
        return
      }
      await afterSignIn("/")
    })
  }

  // An account exists for this address: its password, then accept (sign-in puts the person in their first company; accept then switches to this one).
  function signInAndJoin(e: React.FormEvent) {
    e.preventDefault()
    const r = signInSchema.safeParse({ email: preview.email, password })
    if (!r.success) return setErrors({ password: r.error.issues[0]!.message })
    setErrors({})
    setFail(null)
    start(async () => {
      const s = await signInStep({ signInEmail }, { email: preview.email, password })
      setPassword("")
      if (s.kind === "mfa") return void router.push(signInHref) // the code step lives on the sign-in page; it returns here
      if (s.kind === "unverified") return setFail({ kind: "error", message: "Verify your email first: open the link we sent you, then try again." })
      if (s.kind === "error") return setFail({ kind: "error", message: s.message })
      const a = await acceptInvite(token)
      if (a) setFail(a)
    })
  }

  if (endsFlow)
    return (
      <div className="auth-form" role="alert">
        <header className="auth-head">
          <h1>{fail.kind === "member" ? "You are already in" : "Cannot accept this invitation"}</h1>
          <p>{fail.message}</p>
        </header>
        {fail.kind === "member" && <Link href="/" className="btn btn-primary auth-submit">Open the workspace</Link>}
        {(fail.kind === "email_mismatch" || fail.kind === "signed_out") && <Link href={signInHref} className="btn btn-primary auth-submit">Sign in with another account</Link>}
        {fail.kind !== "member" && fail.kind !== "email_mismatch" && fail.kind !== "signed_out" && <Link href="/" className="auth-link">Back to the app</Link>}
      </div>
    )

  // Signed in.
  if (viewer) {
    if (viewer.toLowerCase() !== preview.email.toLowerCase())
      return (
        <div className="auth-form">
          <header className="auth-head">
            <h1>{headline}</h1>
            <p>{sub}</p>
          </header>
          <div className="auth-notice" role="status">
            <h2>Different account</h2>
            <p>You are signed in as <strong>{viewer}</strong>, but this invitation is for <strong>{preview.email}</strong>.</p>
          </div>
          <Link href={signInHref} className="btn btn-primary auth-submit">Sign in with {preview.email}</Link>
        </div>
      )
    return (
      <div className="auth-form">
        <header className="auth-head">
          <h1>{headline}</h1>
          <p>{sub}</p>
        </header>
        {note}
        <button type="button" className="btn btn-primary auth-submit" disabled={pending} onClick={accept}>{pending ? "Joining…" : `Join ${preview.company}`}</button>
      </div>
    )
  }

  const emailField = (
    <Field label="Email" htmlFor="iv-email" hint="The address this invitation was sent to">
      <Input id="iv-email" type="email" value={preview.email} readOnly autoComplete="username" />
    </Field>
  )

  if (accountExists)
    return (
      <form className="auth-form" onSubmit={signInAndJoin} noValidate>
        <header className="auth-head">
          <h1>{headline}</h1>
          <p>{sub} Sign in to your account to join.</p>
        </header>
        {emailField}
        <Field label="Password" htmlFor="iv-password" error={errors.password} required>
          <SecretInput noun="password" id="iv-password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setErrors({}) }} />
        </Field>
        <div className="auth-row">
          <Link href="/forgot-password" className="auth-link">Forgot password?</Link>
        </div>
        {note}
        <button type="submit" className="btn btn-primary auth-submit" disabled={pending}>{pending ? "Joining…" : "Sign in & join"}</button>
      </form>
    )

  const score = passwordScore(password)
  return (
    <form className="auth-form" onSubmit={join} noValidate>
      <header className="auth-head">
        <h1>{headline}</h1>
        <p>{sub} Choose a password to create your account.</p>
      </header>
      {emailField}
      <Field label="Full name" htmlFor="iv-name" error={errors.name} required>
        <Input id="iv-name" autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); setErrors({}) }} />
      </Field>
      <Field label="Password" htmlFor="iv-password" error={errors.password} required>
        <SecretInput noun="password" id="iv-password" autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setErrors({}) }} />
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
      {note}
      <button type="submit" className="btn btn-primary auth-submit" disabled={pending}>{pending ? "Joining…" : `Join ${preview.company}`}</button>
    </form>
  )
}
