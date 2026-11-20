"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { acceptInvite } from "@/app/actions/invite"
import { Field } from "@/components/field"
import { SecretInput } from "@/components/secret-input"
import { Input } from "@/components/ui/input"
import { resendVerification, signInEmail, signUpEmail } from "@/lib/auth-client"
import { signInStep, signUpStep, type InviteFailKind } from "@/lib/auth-flow"
import { PASSWORD_RULES, ownerSchema, passwordScore } from "../schemas"

type Fail = { kind: InviteFailKind; message: string }
type Mode = "choice" | "signup" | "verify"

// /invite?token=...: the page the invitation email links to. Rendering it calls nothing (a mail scanner or link preview opening the URL must not use the
// invitation): only the Accept click does. Signed in: confirm the account and accept. Signed out: sign in, or create an account here (an invited person
// joins the inviter's company, they do not create their own; the address must be verified before a session exists, like sign-up). The token stays in
// memory and in the `next` of the sign-in link; the API checks that the invited address is the signed-in one.
export function AcceptInvite({ token, email }: { token: string; email: string | null }) {
  const [mode, setMode] = useState<Mode>("choice")
  const [owner, setOwner] = useState({ name: "", email: "", password: "" })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [fail, setFail] = useState<Fail | null>(null)
  const [signedUpAs, setSignedUpAs] = useState("") // "email\n"+password of the account created here (a second click must not sign up twice)
  const [pending, start] = useTransition()

  const here = `/invite?token=${encodeURIComponent(token)}`
  const signInHref = `/sign-in?next=${encodeURIComponent(here)}`

  function accept() {
    setFail(null)
    start(async () => {
      const r = await acceptInvite(token) // success redirects into the company; only a failure comes back
      if (r) setFail(r)
    })
  }

  function submitSignUp(e: React.FormEvent) {
    e.preventDefault()
    const r = ownerSchema.safeParse(owner)
    if (!r.success) {
      const next: Record<string, string> = {}
      for (const i of r.error.issues) next[String(i.path[0])] ??= i.message
      return setErrors(next)
    }
    const who = `${owner.email.trim().toLowerCase()}\n${owner.password}`
    if (signedUpAs === who) return setMode("verify")
    start(async () => {
      const out = await signUpStep({ signUpEmail }, owner)
      if (!out.ok) return setErrors({ email: out.message })
      setSignedUpAs(who)
      setErrors({})
      setMode("verify")
    })
  }

  // The visitor opened the verification link (in another tab): sign in with what they typed, then accept. Until then Better Auth answers 403 email_not_verified.
  function confirmVerified() {
    setFail(null)
    start(async () => {
      const r = await signInStep({ signInEmail }, owner)
      if (r.kind === "unverified") return void toast.error("Not verified yet. Open the link in your inbox, then try again.")
      if (r.kind === "error") return void toast.error(r.message)
      if (r.kind === "mfa") return void toast.error("Sign in to continue.")
      setOwner((o) => ({ ...o, password: "" }))
      const a = await acceptInvite(token)
      if (a) setFail(a)
    })
  }

  function resend() {
    start(async () => {
      await resendVerification(owner.email.trim()).catch(() => {})
      toast.success(`If ${owner.email.trim()} needs a link, a new one is on its way`)
    })
  }

  if (!token)
    return (
      <div className="auth-form">
        <header className="auth-head">
          <h1>Invitation link incomplete</h1>
          <p>This link has no invitation in it. Open the link from your invitation email again, or ask your admin to send a new one.</p>
        </header>
        <Link href="/sign-in" className="btn btn-primary auth-submit">Go to sign in</Link>
      </div>
    )

  // A failed accept ends the flow with the reason and the one thing that helps: another account, a new link, or (already a member) just carry on.
  if (fail && fail.kind !== "rate_limited" && fail.kind !== "error")
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

  const failNote = fail && (fail.kind === "rate_limited" || fail.kind === "error") ? <p className="od-field-err" role="alert">{fail.message}</p> : null

  if (email)
    return (
      <div className="auth-form">
        <header className="auth-head">
          <h1>Join your team</h1>
          <p>You are signed in as <strong>{email}</strong>. Accept the invitation to join the company that invited you.</p>
        </header>
        {failNote}
        <button type="button" className="btn btn-primary auth-submit" disabled={pending} onClick={accept}>{pending ? "Joining…" : "Accept invitation"}</button>
        <p className="auth-alt">
          Invited with a different address? <Link href={signInHref} className="auth-link">Use another account</Link>
        </p>
      </div>
    )

  if (mode === "signup") {
    const score = passwordScore(owner.password)
    const set = (k: "name" | "email" | "password", v: string) => { setOwner({ ...owner, [k]: v }); setErrors({}) }
    return (
      <form className="auth-form" onSubmit={submitSignUp} noValidate>
        <header className="auth-head">
          <h1>Create your account</h1>
          <p>Use the email address this invitation was sent to.</p>
        </header>
        <Field label="Full name" htmlFor="iv-name" error={errors.name} required>
          <Input id="iv-name" autoComplete="name" value={owner.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Work email" htmlFor="iv-email" error={errors.email} required>
          <Input id="iv-email" type="email" autoComplete="username" value={owner.email} placeholder="name@company.com" onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Password" htmlFor="iv-password" error={errors.password} required>
          <SecretInput noun="password" id="iv-password" autoComplete="new-password" value={owner.password} onChange={(e) => set("password", e.target.value)} />
        </Field>
        <div className="auth-strength">
          <div suppressHydrationWarning className="progress" role="progressbar" aria-label="Password strength" aria-valuemin={0} aria-valuemax={PASSWORD_RULES.length} aria-valuenow={score} data-score={score}>
            <i style={{ transform: `scaleX(${score / PASSWORD_RULES.length})` }} />
          </div>
          <ul className="auth-rules" aria-label="Password rules">
            {PASSWORD_RULES.map((r) => {
              const ok = r.test(owner.password)
              return (
                <li key={r.id} data-ok={ok ? "" : undefined}>
                  <span aria-hidden="true">{ok ? "✓" : "○"}</span> {r.label}
                  <span className="sr-only">{ok ? " (met)" : " (not met)"}</span>
                </li>
              )
            })}
          </ul>
        </div>
        <div className="auth-actions">
          <button type="button" className="btn btn-outline" onClick={() => { setMode("choice"); setErrors({}) }}>Back</button>
          <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Creating…" : "Continue"}</button>
        </div>
      </form>
    )
  }

  if (mode === "verify")
    return (
      <div className="auth-form">
        <div className="auth-notice" role="status">
          <h2>Check your inbox</h2>
          <p>We sent a link to <strong>{owner.email.trim()}</strong>. Open it to confirm your address, then come back here to join.</p>
        </div>
        {failNote}
        <div className="auth-actions">
          <button type="button" className="btn btn-outline" onClick={() => setMode("signup")}>Back</button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={confirmVerified}>{pending ? "Joining…" : "I’ve verified"}</button>
        </div>
        <button type="button" className="auth-link" disabled={pending} onClick={resend}>Resend the link</button>
      </div>
    )

  return (
    <div className="auth-form">
      <header className="auth-head">
        <h1>You are invited</h1>
        <p>Sign in or create an account with the email address this invitation was sent to, then accept it to join the team.</p>
      </header>
      <Link href={signInHref} className="btn btn-primary auth-submit">Sign in</Link>
      <button type="button" className="btn btn-outline auth-submit" onClick={() => setMode("signup")}>Create an account</button>
    </div>
  )
}
