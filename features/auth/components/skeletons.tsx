import { Sk, SkGroup } from "@/components/sk"

// Skeletons reuse the real auth classes (.auth-form, .auth-head, .od-field) so paddings and gaps are identical.
// Browser-measured (1440 and 390): h1 line 32, subtitle line 20 (it wraps to a second line on phones, .sk-wrap), field label
// 18.1 + 44px control, hint 17.4. Multi-step pages wrap each step's body in a nested .auth-form, like the real pages.

// `wrap`: the subtitle needs a second line on phones (.sk-wrap); the shorter subtitles fit one line.
function Head({ wrap = true }: { wrap?: boolean }) {
  return (
    <header className="auth-head">
      <Sk w="60%" h={24} r={8} lh={32} />
      <Sk w="92%" h={13} lh={20} style={{ marginTop: 6 }} />
      {wrap && <Sk w="50%" h={13} lh={20} className="sk-wrap" />}
    </header>
  )
}

const FieldSk = ({ hint = false }: { hint?: boolean }) => (
  <div className="od-field">
    <Sk w={96} h={12} lh={18.1} />
    <Sk h={48} r={12} />
    {hint && <div className="od-field-msg"><Sk w={220} h={10} lh={17.4} /></div>}
  </div>
)

const ButtonSk = ({ w = "100%", h = 48 }: { w?: number | string; h?: number }) => <Sk w={w} h={h} r={14} />

function StepperSk({ steps }: { steps: number }) {
  return (
    <div className="auth-stepper">
      <Sk w={72} h={12} lh={18} />
      <div suppressHydrationWarning className="progress"><Sk h={6} r={6} /></div>
      <ol className="auth-steps">
        {Array.from({ length: steps }, (_, i) => (
          <li key={i}><Sk w="100%" h={36} r="pill" /></li>
        ))}
      </ol>
    </div>
  )
}

// `providers`: how many social buttons the page shows (GET /v1/auth/providers). The skeleton never calls the API (B6 I9), so it shows the typical
// two; a deployment with none configured sees the form slightly shorter once loaded.
export function SignInSkeleton({ providers = 2 }: { providers?: number }) {
  return (
    <SkGroup label="Loading sign in" className="auth-form">
      <Head />
      {providers > 0 && (
        <>
          <div className="auth-sso">
            {Array.from({ length: providers }, (_, i) => <Sk key={i} h={48} r={14} />)}
          </div>
          <p className="auth-or"><Sk w={130} h={11} lh={20} style={{ margin: "0 auto" }} /></p>
        </>
      )}
      <FieldSk />
      <FieldSk />
      <div className="auth-row"><Sk w={120} h={13} lh={20} /></div>
      <ButtonSk />
      <Sk w="70%" h={13} lh={20} style={{ margin: "0 auto" }} />
    </SkGroup>
  )
}

export function VerifyEmailSkeleton() {
  return (
    <SkGroup label="Loading email verification" className="auth-form">
      <Head />
      <ButtonSk />
      <Sk w={110} h={13} lh={20} />
    </SkGroup>
  )
}

// The signed-out choice (the usual first visit of an invited person): heading, text, then Sign in and Create an account. The signed-in view is one button and a link.
export function InviteSkeleton() {
  return (
    <SkGroup label="Loading invitation" className="auth-form">
      <Head />
      <ButtonSk />
      <ButtonSk />
    </SkGroup>
  )
}

export function ResetPasswordSkeleton() {
  return (
    <SkGroup label="Loading password reset" className="auth-form">
      <Head wrap={false} />
      <FieldSk />
      {/* .auth-strength: the progress bar, then the four rules in two columns */}
      <div className="auth-strength">
        <div suppressHydrationWarning className="progress"><Sk h={6} r={6} /></div>
        <ul className="auth-rules">
          {Array.from({ length: 4 }, (_, i) => <li key={i}><Sk w="80%" h={11} lh={19} /></li>)}
        </ul>
      </div>
      <FieldSk />
      <ButtonSk />
    </SkGroup>
  )
}

export function ForgotSkeleton() {
  return (
    <SkGroup label="Loading forgot password" className="auth-form">
      <Head />
      <FieldSk />
      <ButtonSk />
      <Sk w={110} h={13} lh={20} />
    </SkGroup>
  )
}

export function SignUpSkeleton() {
  return (
    <SkGroup label="Loading sign up" className="auth-form">
      <Head />
      <StepperSk steps={4} />
      <div className="auth-form">
        <FieldSk />
        {/* .auth-preview: -4px top margin; the seeded workspace URL wraps to a second line on phones */}
        <span className="auth-preview">
          <Sk w="65%" h={13} lh={18.8} />
          <Sk w="40%" h={13} lh={18.9} className="sk-wrap" />
        </span>
        <div className="od-row2"><FieldSk /><FieldSk /></div>
        <ButtonSk />
      </div>
      <Sk w="60%" h={13} lh={20} style={{ margin: "0 auto" }} />
    </SkGroup>
  )
}

export function OnboardingSkeleton({ departments = 2 }: { departments?: number }) {
  return (
    <SkGroup label="Loading onboarding" className="auth-form">
      <Head />
      <StepperSk steps={4} />
      <div className="auth-form">
        {/* FormSection: 30px icon chip + 15px title (line 22) */}
        <section className="fs-sec">
          <h3 className="fs-sec-h">
            <span className="fs-sec-i" aria-hidden="true" />
            <Sk w={96} h={14} lh={22} />
          </h3>
          <ul className="auth-list">
            {Array.from({ length: departments }, (_, i) => (
              <li key={i}>
                <FieldSk />
                <Sk w={92} h={48} r={14} />
              </li>
            ))}
          </ul>
          <Sk w={170} h={48} r={14} />
        </section>
        <div className="auth-actions"><ButtonSk w={140} h={46.3} /></div>
      </div>
    </SkGroup>
  )
}
