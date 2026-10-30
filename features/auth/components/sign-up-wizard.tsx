"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"

import { useSlideDir } from "@/components/data-pagination"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Input } from "@/components/ui/input"
import { PASSWORD_RULES, orgSchema, ownerSchema, passwordScore, slugify } from "../schemas"
import type { OnboardingDefaults, PlanOption } from "../types"
import { Stepper } from "./stepper"

const STEPS = ["Organisation", "Owner account", "Verify email", "Plan"]
type Errors = Record<string, string>

const money = (p: PlanOption, locale: string) => new Intl.NumberFormat(locale, { style: "currency", currency: p.currency, maximumFractionDigits: 0 }).format(p.priceMonthly)

// FR-SAAS-03: organisation, owner, email verification (mock), plan. Finish hands over to /onboarding.
export function SignUpWizard({ defaults, plans }: { defaults: OnboardingDefaults; plans: PlanOption[] }) {
  const router = useRouter()
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
    go(2)
  }
  function confirmVerified() {
    setVerified(true)
    toast.success("Email verified")
    go(3)
  }
  function finish() {
    const chosen = plans.find((p) => p.id === plan)
    toast.success(`${org.company.trim()} created. ${chosen ? `${chosen.name} trial started.` : ""}`)
    router.push("/onboarding")
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
            <button type="submit" className="btn btn-primary">Continue</button>
          </div>
        </form>
      )}

      {step === 2 && (
        <div className="auth-form od-slide" data-slide={dir}>
          <div className="auth-notice" role="status">
            <h2>Verify your email</h2>
            <p>
              We sent a link to <strong>{owner.email.trim()}</strong>. Open it to confirm your address, then come back here.
            </p>
          </div>
          <div className="auth-actions">
            <button type="button" className="btn btn-outline" onClick={() => go(1)}>Back</button>
            <button type="button" className="btn btn-primary" onClick={confirmVerified}>I&apos;ve verified</button>
          </div>
          <button type="button" className="auth-link" onClick={() => toast.success(`Verification link re-sent to ${owner.email.trim()}`)}>
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
            <button type="button" className="btn btn-primary" disabled={!verified} onClick={finish}>
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
