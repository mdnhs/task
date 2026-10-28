"use client"

import Link from "next/link"
import { useState, useTransition } from "react"

import { signIn } from "@/app/actions/session"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Input } from "@/components/ui/input"
import { mfaSchema, signInSchema } from "../schemas"
import type { RoleOption } from "../types"

type Stage = "credentials" | "mfa" | "role"

// FR-AUTH-01/04: credentials, then a 6-digit code (any 6 digits pass in the mock), then "Continue as".
export function SignInForm({ roles }: { roles: RoleOption[] }) {
  const [stage, setStage] = useState<Stage>("credentials")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [role, setRole] = useState("owner")
  const [errors, setErrors] = useState<Record<string, string>>({})
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
    setStage("mfa")
  }

  function mfa(e: React.FormEvent) {
    e.preventDefault()
    const r = mfaSchema.safeParse(code)
    if (!r.success) return setErrors({ code: r.error.issues[0].message })
    setErrors({})
    setStage("role")
  }

  function finish(e: React.FormEvent) {
    e.preventDefault()
    start(() => signIn(role))
  }

  if (stage === "mfa")
    return (
      <form className="auth-form" onSubmit={mfa} noValidate>
        <header className="auth-head">
          <h1>Two-step verification</h1>
          <p>Enter the 6-digit code from your authenticator app for {email.trim()}.</p>
        </header>
        <Field label="6-digit code" htmlFor="si-code" error={errors.code} hint="Demo: any 6 digits are accepted." required>
          <Input
            id="si-code"
            className="auth-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ""))
              setErrors({})
            }}
          />
        </Field>
        <button type="submit" className="btn btn-primary auth-submit">
          Verify
        </button>
        <button type="button" className="auth-link" onClick={() => { setStage("credentials"); setCode(""); setErrors({}) }}>
          Back to sign in
        </button>
      </form>
    )

  if (stage === "role")
    return (
      <form className="auth-form" onSubmit={finish}>
        <header className="auth-head">
          <h1>Continue as</h1>
          <p>Pick the role to open the workspace with.</p>
        </header>
        <Field label="Role" htmlFor="si-role">
          <FilterSelect label="Role" value={role} options={roles.map((r) => ({ value: r.id, label: r.label }))} onChange={setRole} />
        </Field>
        <button type="submit" className="btn btn-primary auth-submit" disabled={pending}>
          {pending ? "Signing in…" : "Continue"}
        </button>
      </form>
    )

  return (
    <form className="auth-form" onSubmit={credentials} noValidate>
      <header className="auth-head">
        <h1>Sign in</h1>
        <p>Welcome back. Sign in to your company workspace.</p>
      </header>
      <Field label="Work email" htmlFor="si-email" error={errors.email} required>
        <Input id="si-email" type="email" autoComplete="username" value={email} placeholder="name@company.com" onChange={(e) => { setEmail(e.target.value); setErrors((x) => ({ ...x, email: "" })) }} />
      </Field>
      <Field label="Password" htmlFor="si-password" error={errors.password} hint="Demo: any email and a password of 8+ characters." required>
        <Input id="si-password" type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setErrors((x) => ({ ...x, password: "" })) }} />
      </Field>
      <div className="auth-row">
        <Link href="/forgot-password" className="auth-link">
          Forgot password?
        </Link>
      </div>
      <button type="submit" className="btn btn-primary auth-submit">
        Continue
      </button>
      <p className="auth-alt">
        New to OpsDesk? <Link href="/sign-up" className="auth-link">Create a company account</Link>
      </p>
    </form>
  )
}
