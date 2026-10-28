"use client"

// Wizard header: a step list (completed/visited steps can be revisited) and a `.progress` bar.
// The bar fills with scaleX (no layout cost), gliding forward as a step completes and back when you return to one.
export function Stepper({
  steps,
  current,
  reached,
  onGo,
  label,
}: {
  steps: string[]
  current: number
  /** Highest step index the user has unlocked. */
  reached: number
  onGo(i: number): void
  label: string
}) {
  const pct = ((current + 1) / steps.length) * 100
  return (
    <div className="auth-stepper">
      <p className="auth-step-count">
        Step {current + 1} of {steps.length}
      </p>
      <div suppressHydrationWarning className="progress" role="progressbar" aria-label={label} aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={current + 1}>
        <i style={{ transform: `scaleX(${pct / 100})` }} />
      </div>
      <ol className="auth-steps">
        {steps.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              className="auth-step"
              data-state={i === current ? "current" : i <= reached ? "done" : "todo"}
              aria-current={i === current ? "step" : undefined}
              disabled={i > reached}
              onClick={() => onGo(i)}
            >
              <span className="auth-step-n">{i + 1}</span>
              <span className="auth-step-l">{s}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
