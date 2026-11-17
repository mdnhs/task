"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { toast } from "sonner"

import { afterSignIn } from "@/app/actions/session"
import { useSlideDir } from "@/components/data-pagination"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Input } from "@/components/ui/input"
import { resendVerification, signInEmail, signUpEmail } from "@/lib/auth-client"
import { signInStep, signUpStep } from "@/lib/auth-flow"
import { SIGNUP_KEY } from "../signup-handoff"
import { PASSWORD_RULES, orgSchema, ownerSchema, passwordScore, slugify } from "../schemas"
import type { OnboardingDefaults, PlanOption } from "../types"
import { Stepper } from "./stepper"

const STEPS = ["Organisation", "Owner account", "Verify email", "Plan"]
type Errors = Record<string, string>

const money = (p: PlanOption, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: p.currency, maximumFractionDigits: 0 }).format(p.priceMonthly)

// FR-SAAS-03: organisation, owner account, email verification, plan. Sign-up creates NO session (the address must be verified first): step 2 waits for the
// emailed link, "I've verified" then signs in. Finish hands over to /onboarding, which creates the company (the choices travel in sessionStorage, not secret).
export function SignUpWizard({ defaults, plans }: { defaults: OnboardingDefaults; plans: PlanOption[] }) {
  const num = (n: number) => new Intl.NumberFormat(defaults.locale).format(n)
  const [step, setStep] = useState(0)
  // Next step slides in from the right, going back from the left.
  const dir = useSlideDir(step)
  const [reached, setReached] = useState(0)
  const [errors, setErrors] = useState<Errors>({})
  const first = defaults.countries[0]
  const [org, setOrg] = useState({ company: "", country: first.code, timezone: first.timezone })
  const [owner, setOwner] = useState({ name: "", email: "", password: "" })
  const [verified, setVerified] = useState(false)
  const [signedUpAs, setSignedUpAs] = useState("") // "email\n"+password of the account this wizard already created (a second click must not sign up twice)
  const [pending, start] = useTransition()
  const [plan, setPlan] = useState(plans.find((p) => p.id === defaults.defaultPlan)?.id ?? plans[0].id)

  const go = (i: number) => {
    setErrors({})
    setStep(i)
    setReached((r) => Math.max(r, i))
  }
  // Stepper jumps forward only when the steps in between still validate (edits after "Continue" can break them).
  const jump = (i: number) => {
    if (i > step) {
      if (step === 0) { const r = orgSchema.safeParse(org); if (!r.success) return fail(r.error.issues) }
      if (step === 1) { const r = ownerSchema.safeParse(owner); if (!r.success) return fail(r.error.issues) }
    }
    go(i)
  }
  const fail = (issues: { path: PropertyKey[]; message: string }[]) => {
    const next: Errors = {}
    for (const i of issues) next[String(i.path[0])] ??= i.message
    setErrors(next)
  }

  function submitOrg(e: React.FormEvent) {
    e.preventDefault()
    const r = orgSchema.safeParse(org)
    if (!r.success) return fail(r.error.issues)
    go(1)
  }
  function submitOwner(e: React.FormEvent) {
    e.preventDefault()
    const r = ownerSchema.safeParse(owner)
    if (!r.success) return fail(r.error.issues)
    setVerified(false)
    const who = `${owner.email.trim().toLowerCase()}\n${owner.password}`
    if (signedUpAs === who) return go(2)
    start(async () => {
      const out = await signUpStep({ signUpEmail }, owner)
      if (!out.ok) return setErrors({ email: out.message })
      setSignedUpAs(who)
      go(2)
    })
  }
  // The visitor has opened the link (in another tab): sign in with the credentials typed in step 2. Until then Better Auth answers 403 email_not_verified.
  function confirmVerified() {
    start(async () => {
      const r = await signInStep({ signInEmail }, owner)
      if (r.kind === "unverified") return void toast.error("Not verified yet. Open the link in your inbox, then try again.")
      if (r.kind === "error") return void toast.error(r.message)
      if (r.kind === "mfa") return void toast.error("Sign in to continue.")
      setOwner((o) => ({ ...o, password: "" }))
      setVerified(true)
      toast.success("Email verified")
      go(3)
    })
  }
  function resend() {
    start(async () => {
      await resendVerification(owner.email.trim()).catch(() => {})
      toast.success(`If ${owner.email.trim()} needs a link, a new one is on its way`)
    })
  }
  function finish() {
    try {
      sessionStorage.setItem(SIGNUP_KEY, JSON.stringify({ company: org.company.trim(), country: org.country, timezone: org.timezone, plan }))
    } catch {
      /* private mode: onboarding then asks for the company name */
    }
    start(() => afterSignIn("/onboarding")) // no company yet: the server sends the signed-in visitor to /onboarding
  }

  const slug = slugify(org.company)
  const score = passwordScore(owner.password)
  const chosen = plans.find((p) => p.id === plan) ?? plans[0]

  return (
    <div className="auth-form">
      <header className="auth-head">
        <h1>Create a company account</h1>
        <p>Set up your workspace in a few steps. No card needed for the trial.</p>
      </header>
      <Stepper steps={STEPS} current={step} reached={reached} onGo={jump} label="Sign-up progress" />

      {step === 0 && (
        <form className="auth-form od-slide" data-slide={dir} onSubmit={submitOrg} noValidate>
          <Field label="Company name" htmlFor="su-company" error={errors.company} required>
            <Input id="su-company" autoComplete="organization" value={org.company} onChange={(e) => { setOrg({ ...org, company: e.target.value }); setErrors({}) }} />
          </Field>
          <p className="auth-preview" aria-live="polite">
            Your workspace address: <strong>{slug || "your-company"}.{defaults.domain}</strong>
          </p>
          <div className="od-row2">
            <Field label="Country" htmlFor="su-country" error={errors.country} required>
              <FilterSelect
                label="Country"
                value={org.country}
                options={defaults.countries.map((c) => ({ value: c.code, label: c.name }))}
                onChange={(code) => setOrg({ ...org, country: code, timezone: defaults.countries.find((c) => c.code === code)?.timezone ?? org.timezone })}
              />
            </Field>
            <Field label="Timezone" htmlFor="su-tz" error={errors.timezone} required>
              <FilterSelect label="Timezone" value={org.timezone} options={defaults.timezones.map((t) => ({ value: t.value, label: t.label }))} onChange={(v) => setOrg({ ...org, timezone: v })} />
            </Field>
          </div>
          <button type="submit" className="btn btn-primary auth-submit">Continue</button>
        </form>
      )}

      {step === 1 && (
        <form className="auth-form od-slide" data-slide={dir} onSubmit={submitOwner} noValidate>
          <Field label="Full name" htmlFor="su-name" error={errors.name} required>
            <Input id="su-name" autoComplete="name" value={owner.name} onChange={(e) => { setOwner({ ...owner, name: e.target.value }); setVerified(false); setErrors({}) }} />
          </Field>
          <Field label="Work email" htmlFor="su-email" error={errors.email} required>
            <Input id="su-email" type="email" autoComplete="username" value={owner.email} placeholder="name@company.com" onChange={(e) => { setOwner({ ...owner, email: e.target.value }); setVerified(false); setErrors({}) }} />
          </Field>
          <Field label="Password" htmlFor="su-password" error={errors.password} required>
            <Input id="su-password" type="password" autoComplete="new-password" value={owner.password} onChange={(e) => { setOwner({ ...owner, password: e.target.value }); setVerified(false); setErrors({}) }} />
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
            <button type="button" className="btn btn-outline" onClick={() => go(0)}>Back</button>
            <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "Creating…" : "Continue"}</button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="auth-form od-slide" data-slide={dir}>
          <div className="auth-notice" role="status">
            <h2>Check your inbox</h2>
            <p>
              We sent a link to <strong>{owner.email.trim()}</strong>. Open it to confirm your address, then come back here.
            </p>
          </div>
          <div className="auth-actions">
            <button type="button" className="btn btn-outline" onClick={() => go(1)}>Back</button>
            <button type="button" className="btn btn-primary" disabled={pending} onClick={confirmVerified}>{pending ? "Checking…" : "I\u2019ve verified"}</button>
          </div>
          <button type="button" className="auth-link" disabled={pending} onClick={resend}>
            Resend the link
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="auth-form od-slide" data-slide={dir}>
          <div className="auth-plans" role="radiogroup" aria-label="Plan">
            {plans.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={p.id === plan} className="auth-plan" data-selected={p.id === plan ? "" : undefined} onClick={() => setPlan(p.id)}>
                <span className="auth-plan-name">{p.name}</span>
                <span className="auth-plan-price">{money(p, defaults.locale)}<small> / month</small></span>
                <ul>
                  <li>Up to {num(p.limits.activeUsers)} active users</li>
                  <li>{num(p.limits.storageGb)} GB storage</li>
                  <li>{num(p.limits.messages)} messages</li>
                  <li>{num(p.limits.transcriptionMinutes)} transcription minutes</li>
                </ul>
              </button>
            ))}
          </div>
          {!verified && (
            <p className="auth-sub">
              Verify your email first. <button type="button" className="auth-link" onClick={() => go(2)}>Go to verification</button>
            </p>
          )}
          <div className="auth-actions">
            <button type="button" className="btn btn-outline" onClick={() => go(2)}>Back</button>
            <button type="button" className="btn btn-primary" disabled={!verified || pending} onClick={finish}>
              Start {chosen.trialDays}-day trial
            </button>
          </div>
        </div>
      )}

      <p className="auth-alt">
        Already have an account? <Link href="/sign-in" className="auth-link">Sign in</Link>
      </p>
    </div>
  )
}
