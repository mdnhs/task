"use client"

import { Children, cloneElement, createContext, isValidElement, useContext } from "react"

type FieldCtx = { id: string; describedBy?: string; invalid: boolean; required: boolean }
const FieldContext = createContext<FieldCtx | null>(null)

/** For controls that are not plain DOM inputs (shadcn Select): spread these onto the element carrying id={htmlFor}. */
export function useField(): FieldCtx | null {
  return useContext(FieldContext)
}

// Label + control + hint/error. The element carrying id={htmlFor} must get the aria props: a single element child gets
// them via cloneElement (input/textarea/shadcn Input); controls whose root isn't the DOM input (Select) read useField(). Message id is `${htmlFor}-msg`.
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  announce = true,
  children,
}: {
  label: string
  htmlFor: string
  error?: string
  hint?: string
  required?: boolean
  /** Errors get role="alert" by default. Set false when a parent (e.g. a form-level error summary) does the announcing. */
  announce?: boolean
  children: React.ReactNode
}) {
  const msg = error ?? hint
  const msgId = `${htmlFor}-msg`
  const ctx: FieldCtx = { id: htmlFor, describedBy: msg ? msgId : undefined, invalid: !!error, required: !!required }
  const only = Children.count(children) === 1 && isValidElement(children) ? children : null
  const control = only
    ? cloneElement(only as React.ReactElement<Record<string, unknown>>, {
        "aria-describedby": ctx.describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required || undefined,
      })
    : children
  return (
    <FieldContext.Provider value={ctx}>
      <div className="od-field" data-invalid={error ? "" : undefined}>
        <label htmlFor={htmlFor}>
          {label}
          {required && <span className="od-req" aria-hidden="true"> *</span>}
        </label>
        {control}
        {/* A new error row opens smoothly (grid rows 0fr→1fr, .od-field-msg.is-enter) instead of jumping the layout;
            an error replacing a hint keeps the row and only fades the text. The invalid control shakes once (CSS). */}
        {msg && (
          <div className={hint ? "od-field-msg" : "od-field-msg is-enter"}>
            <p key={error ? "err" : "hint"} id={msgId} className={error ? "od-field-err" : "od-field-hint"} role={error && announce ? "alert" : undefined}>
              {msg}
            </p>
          </div>
        )}
      </div>
    </FieldContext.Provider>
  )
}
