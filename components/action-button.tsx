"use client"

import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react"

import { ACTION } from "@/lib/motion"
import { cn } from "@/lib/utils"

const wait = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000))
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

type Phase = "idle" | "pending" | "done"

/**
 * A key action button (submit, approve, save…) with press → pending → done feedback (ui-rules.md → Motion).
 * Click: the work runs first, with no artificial wait, so errors and results show at once. A spinner replaces the label (the
 * label stays in the box, invisible, so the width never changes) only while `onAction` is really async; then a ✓ draws
 * for ACTION.done if the button is still on screen; then the label returns.
 * - `onAction` returning `false` (or throwing) = it did not go through (validation): stays on the label, no spinner, no ✓.
 * - `onDone` runs right after success: use it for what removes the button (closing a dialog, moving a task to its next status).
 * - `type="submit"`: the button submits its form at once (`requestSubmit`, so the form's own onSubmit validates and saves).
 *   If the form then shows an invalid field ([aria-invalid] / Field's [data-invalid]), no ✓.
 * Clicks while busy are ignored; `disabled` keeps the plain disabled look and cursor:not-allowed.
 */
export function ActionButton({
  onAction,
  onDone,
  type = "button",
  className,
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> & {
  onAction?: () => unknown
  onDone?: () => void
}) {
  const [phase, setPhase] = useState<Phase>("idle")
  const ref = useRef<HTMLButtonElement>(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])

  async function run() {
    const btn = ref.current
    const form = type === "submit" ? btn?.form : null
    if (form && !form.noValidate && !form.checkValidity()) return void form.reportValidity()
    let ok = true
    try {
      let r = onAction?.()
      // Spinner only for real async work; a synchronous result (incl. a validation `false`) shows immediately.
      if (r instanceof Promise) {
        setPhase("pending")
        r = await r
      }
      ok = r !== false
      if (ok && form && btn) {
        form.requestSubmit(btn)
        await nextFrame()
        ok = !(form.isConnected && form.querySelector('[aria-invalid="true"],[data-invalid]'))
      }
    } catch {
      ok = false
    }
    if (!live.current) return
    if (!ok) return setPhase("idle")
    onDone?.()
    if (!live.current || !ref.current?.isConnected) return
    setPhase("done")
    await wait(ACTION.done)
    if (live.current) setPhase("idle")
  }

  return (
    <button
      ref={ref}
      type={type}
      className={cn(className, "od-act")}
      data-phase={phase === "idle" ? undefined : phase}
      aria-busy={phase === "pending" || undefined}
      onClick={(e) => {
        if (type === "submit") e.preventDefault()
        if (phase === "idle") void run()
      }}
      {...rest}
    >
      <span className="od-act-label">{children}</span>
      <span className="od-act-ico" aria-hidden="true">
        {phase === "pending" && <span className="od-spin" />}
        {phase === "done" && (
          <svg viewBox="0 0 16 16">
            <path pathLength={1} d="M3.5 8.4 6.6 11.4 12.5 5" />
          </svg>
        )}
      </span>
    </button>
  )
}
