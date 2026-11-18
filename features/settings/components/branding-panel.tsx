"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { FormSection } from "@/components/form-section"
import { ColorPicker } from "@/components/ui/color-picker"
import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import { BRAND_STYLE_ID, brandCss } from "@/lib/brand"
import { LOGO_ACCEPT, initialsOf, logoError } from "@/lib/branding"
import { fieldErrorOf } from "../adapters"
import { makeSettingsClient } from "../client"
import { LOGO_UPLOAD_ENABLED } from "../constants"

const schema = z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6 digit hex colour, like #2f6f5e") })

// Branding (FR-SAAS-11, GET/PUT /v1/settings/branding): the brand colour, with a live preview of the sidebar chip, and the logo when the plan has the files module
// (the upload goes straight to storage and must pass the malware scan). The upload is hidden for now (LOGO_UPLOAD_ENABLED): the shell cannot show a logo yet.
// The appearance presets and a separate display name have no backend (the company name is edited on the Organisation tab).
export function BrandingPanel({ name, color, logoFileId, presets, canWrite, canUpload }: { name: string; color: string; logoFileId: string | null; presets: string[]; canWrite: boolean; canUpload: boolean }) {
  const run = useApiAction()
  const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })
  const [value, setValue] = useState(color)
  const [logoId, setLogoId] = useState(logoFileId)
  const [over, setOver] = useState(false)
  const [errors, setErrors] = useState<{ color?: string; logo?: string }>({})
  const file = useRef<HTMLInputElement>(null)
  const valid = /^#[0-9a-fA-F]{6}$/.test(value)
  const chip = valid ? value : color
  const saved = useRef(color)

  // Live preview: the whole app takes the picked colour at once. Leaving without saving puts the saved colour back.
  useEffect(() => {
    saved.current = color
  }, [color])
  useEffect(() => {
    const el = document.getElementById(BRAND_STYLE_ID)
    if (el) el.textContent = brandCss(chip)
  }, [chip])
  useEffect(() => () => {
    const el = document.getElementById(BRAND_STYLE_ID)
    if (el) el.textContent = brandCss(saved.current)
  }, [])

  async function pick(f: File | undefined) {
    if (!f || !canWrite || !canUpload) return
    const err = logoError(f)
    if (err) return setErrors((e) => ({ ...e, logo: err }))
    const r = await run("logo", () => client.uploadLogo(f), { handled: (e) => (fieldErrorOf(e) ? (setErrors((x) => ({ ...x, logo: fieldErrorOf(e)!.message })), true) : false) })
    if (r.ok) {
      setLogoId(r.value)
      setErrors((e) => ({ ...e, logo: undefined }))
    }
  }

  // ActionButton drives the feedback: spinner while the call runs, then a tick. `false` = not saved (no tick).
  async function save() {
    const parsed = schema.safeParse({ color: value })
    if (!parsed.success) {
      setErrors({ color: parsed.error.issues[0]?.message })
      return false
    }
    const r = await run("branding", () => client.saveBranding({ color: parsed.data.color, logoFileId: logoId }), {
      handled: (e) => {
        const f = fieldErrorOf(e)
        if (!f) return false
        setErrors({ [f.field === "logo" ? "logo" : "color"]: f.message })
        return true
      },
    })
    if (r.ok) toast.success("Branding saved", { description: name })
    return r.ok
  }

  return (
    <section className="card set-card" aria-labelledby="set-brand-h" data-readonly={canWrite ? undefined : ""}>
      <div className="card-head">
        <div>
          <h2 id="set-brand-h">Branding</h2>
          <div className="sub">How your workspace looks to your team</div>
        </div>
      </div>
      <div className="set-brand">
        <form className="od-form set-form" noValidate onSubmit={(e) => { e.preventDefault(); document.getElementById("brand-save")?.click() }}>
          {LOGO_UPLOAD_ENABLED && (
          <FormSection icon="image" title="Logo">
            {canUpload ? (
              <Field label="Logo" htmlFor="brand-logo" error={errors.logo} hint="PNG, JPG, SVG or WebP, up to 512 KB">
                <span className="set-upload">
                  <input ref={file} id="brand-logo" type="file" accept={LOGO_ACCEPT} className="sr-only" tabIndex={-1} disabled={!canWrite} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = "" }} />
                  <button
                    type="button"
                    className="set-drop"
                    data-over={over ? "" : undefined}
                    data-disabled={canWrite ? undefined : ""}
                    disabled={!canWrite}
                    onClick={() => file.current?.click()}
                    onDragOver={(e) => { if (!canWrite) return; e.preventDefault(); setOver(true) }}
                    onDragLeave={() => setOver(false)}
                    onDrop={(e) => { e.preventDefault(); setOver(false); void pick(e.dataTransfer.files?.[0]) }}
                  >
                    <strong>{logoId ? "Replace logo" : "Upload logo"}</strong>
                    <span>Click or drop an image</span>
                  </button>
                  {logoId && canWrite && <button type="button" className="btn btn-outline" onClick={() => setLogoId(null)}>Remove logo</button>}
                </span>
              </Field>
            ) : (
              <p className="od-field-hint">Logo upload isn&apos;t in your plan. Colour only.</p>
            )}
          </FormSection>
          )}
          <FormSection icon="palette" title="Colour">
            <Field label="Brand colour" htmlFor="brand-color" error={errors.color} required>
              <ColorPicker id="brand-color" aria-label="Brand colour" value={value} presets={presets} disabled={!canWrite} readOnly={!canWrite} invalid={!!errors.color} onValueChange={(hex) => { setValue(hex); setErrors((x) => ({ ...x, color: undefined })) }} />
            </Field>
          </FormSection>
          {canWrite && (
            <div className="od-form-foot">
              {(chip.toLowerCase() !== color.toLowerCase() || logoId !== logoFileId) && <span className="od-field-hint">Previewing. Save to keep these changes.</span>}
              <ActionButton id="brand-save" className="btn btn-primary" onAction={save}>Save branding</ActionButton>
            </div>
          )}
        </form>
        <div className="set-preview" aria-label="Sidebar preview">
          <div className="set-preview-bar">
            <span className="set-preview-chip">{initialsOf(name)}</span>
            <span className="set-preview-name">{name.trim() || "Your company"}</span>
          </div>
          <p className="od-field-hint">Live preview of the sidebar logo</p>
        </div>
      </div>
    </section>
  )
}
