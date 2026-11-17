"use client"

import { useState } from "react"
import { toast } from "sonner"
import { z } from "zod"

import { Field } from "@/components/field"
import { Input } from "@/components/ui/input"
import { useApiAction } from "@/hooks/use-api-action"
import { updateName } from "@/lib/auth-client"
import type { ProfileData } from "../types"

// Profile (own account): the display name is the only editable field. Email, role, department and timezone come from the session / org.
export function ProfilePanel({
  data,
  name,
  email,
  initials,
  role,
  tzLabel,
  department,
}: {
  data: ProfileData
  name: string
  email: string
  initials: string
  role: string
  tzLabel: string
  /** The department team the person belongs to ("" when none). */
  department: string
}) {
  const run = useApiAction()
  const saved = name
  const [value, setValue] = useState(saved)
  const [error, setError] = useState<string>()
  const schema = z.object({
    name: z.string().trim().min(data.nameMin, "Enter your name").max(data.nameMax, `Keep the name under ${data.nameMax} characters`),
  })
  const dirty = value.trim() !== saved

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const parsed = schema.safeParse({ name: value })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    // Better Auth's update-user (the one profile field a member may change); the page then re-reads the session, so the new name is the server's.
    const r = await run("profile-name", () => updateName(parsed.data.name))
    if (r.ok) {
      setValue(parsed.data.name)
      toast.success("Profile saved", { description: `Display name is now ${parsed.data.name}` })
    }
  }

  return (
    <section className="card set-card" aria-labelledby="acc-prof-h">
      <div className="card-head">
        <div>
          <h2 id="acc-prof-h">Profile</h2>
          <div className="sub">How you appear to your team</div>
        </div>
      </div>
      <div className="acc-id">
        <span className="avatar av-me acc-avatar" aria-hidden="true">{initials}</span>
        <div className="acc-id-text">
          <b>{saved}</b>
          <span>{role}</span>
        </div>
      </div>
      <form className="od-form set-form" onSubmit={save} noValidate>
        <div className="od-row2">
          <Field label="Display name" htmlFor="acc-name" error={error} required>
            <Input
              id="acc-name"
              value={value}
              autoComplete="name"
              onChange={(e) => {
                setValue(e.target.value)
                setError(undefined)
              }}
            />
          </Field>
          <Field label="Email" htmlFor="acc-email" hint="Ask an admin to change it">
            <Input id="acc-email" value={email} readOnly />
          </Field>
        </div>
        <div className="od-row2">
          <Field label="Role" htmlFor="acc-role">
            <Input id="acc-role" value={role} readOnly />
          </Field>
          <Field label="Department" htmlFor="acc-dept">
            <Input id="acc-dept" value={department || "All departments"} readOnly />
          </Field>
        </div>
        <div className="od-row2">
          <Field label="Timezone" htmlFor="acc-tz">
            <Input id="acc-tz" value={tzLabel} readOnly />
          </Field>
        </div>
        <div className="od-form-foot">
          <button type="submit" className="btn btn-primary" disabled={!dirty}>Save changes</button>
        </div>
      </form>
    </section>
  )
}
