"use client"

import { useEffect, useRef, useState } from "react"

import { Icon } from "@/components/icon"
import { Input } from "@/components/ui/input"

type Props = Omit<React.ComponentProps<"input">, "type"> & {
  /** Toggle label: "Show password" for passwords, "Show secret" (default) for API keys. */
  noun?: "secret" | "password"
}

// Password / API-key input with an eye toggle. It only reveals what the user typed or pasted in this session (the value is the caller's
// controlled state): stored secrets are never sent to the browser, so there is nothing else to reveal. The reveal state is local React state
// (not in the URL, storage or logs) and re-masks on blur (focus leaving the field and its button), on form submit and on unmount.
// Extra props (id, aria-*, autoComplete, name...) go to the <input>, so <Field> can clone its aria props onto this component.
export function SecretInput({ noun = "secret", disabled, ...props }: Props) {
  const [shown, setShown] = useState(false)
  const wrap = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const form = wrap.current?.closest("form")
    if (!form) return
    const hide = () => setShown(false)
    form.addEventListener("submit", hide)
    return () => form.removeEventListener("submit", hide)
  }, [])

  return (
    <span
      ref={wrap}
      className="od-secret"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setShown(false)
      }}
    >
      <Input {...props} type={shown ? "text" : "password"} disabled={disabled} spellCheck={false} autoCapitalize="off" />
      <button
        type="button"
        className="od-secret-btn"
        aria-label={shown ? `Hide ${noun}` : `Show ${noun}`}
        aria-pressed={shown}
        aria-controls={props.id}
        disabled={disabled}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShown((v) => !v)}
      >
        <Icon name={shown ? "eye-off" : "eye"} />
      </button>
    </span>
  )
}
