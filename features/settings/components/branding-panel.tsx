"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { z } from "zod"

import { ActionButton } from "@/components/action-button"
import { Field } from "@/components/field"
import { ColorPicker } from "@/components/ui/color-picker"
import { Input } from "@/components/ui/input"
import { saveBranding } from "@/app/actions/session"
import { useTenantLogo } from "@/hooks/use-branding"
import { BRAND_STYLE_ID, brandCss } from "@/lib/brand"
import { LOGO_ACCEPT, initialsOf, isLogoDataUrl, logoError } from "@/lib/branding"
const schema = z.object({
  name: z.string().trim().min(2, "Enter the display name").max(60, "Keep the name under 60 characters"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6 digit hex colour, like #2f6f5e"),
})

// Branding (FR-SAAS-11): name, logo and brand colour with a live preview of the sidebar logo chip.
export function BrandingPanel({ tenantId, name, color, presets, canWrite }: { tenantId: string; name: string; color: string; presets: string[]; canWrite: boolean }) {
  const [form, setForm] = useState({ name, color })
  const [savedLogo, saveLogo] = useTenantLogo(tenantId)
  const [logo, setLogo] = useState<string>(savedLogo)
  const [over, setOver] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; color?: string; logo?: string }>({})
  const file = useRef<HTMLInputElement>(null)
  const valid = /^#[0-9a-fA-F]{6}$/.test(form.color)
  const chip = valid ? form.color : color
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

  function pick(f: File | undefined) {
    if (!f || !canWrite) return
    const err = logoError(f)
    if (err) return setErrors((e) => ({ ...e, logo: err }))
    const r = new FileReader()
    r.onload = () => {
      if (!isLogoDataUrl(r.result)) return setErrors((e) => ({ ...e, logo: "Use a PNG, JPG, SVG or WebP image" }))
      setLogo(r.result)
      setErrors((e) => ({ ...e, logo: undefined }))
    }
    r.onerror = () => setErrors((e) => ({ ...e, logo: "That file could not be read. Try another image." }))
    r.readAsDataURL(f)
  }

  // ActionButton drives the feedback: spinner while the server action runs, then a tick. `false` = not saved (no tick).
  async function save() {
    const parsed = schema.safeParse(form)
    if (!parsed.success) {
      const next: typeof errors = {}
      for (const i of parsed.error.issues) {
        const k = i.path[0] as "name" | "color"
        if (!next[k]) next[k] = i.message
      }
      setErrors(next)
      return false
    }
    const r = await saveBranding(parsed.data)
    if (r.ok) saveLogo(tenantId, logo)
    if (r.ok) toast.success("Branding saved", { description: parsed.data.name })
    else toast.error("Branding not saved", { description: "Check the name and colour, then try again." })
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
          <Field label="Display name" htmlFor="brand-name" error={errors.name} required>
            <Input id="brand-name" value={form.name} readOnly={!canWrite} onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setErrors((x) => ({ ...x, name: undefined })) }} />
          </Field>
          <Field label="Logo" htmlFor="brand-logo" error={errors.logo} hint="PNG, JPG, SVG or WebP, up to 512 KB">
            <span className="set-upload">
              <input ref={file} id="brand-logo" type="file" accept={LOGO_ACCEPT} className="sr-only" tabIndex={-1} disabled={!canWrite} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = "" }} />
              <button
                type="button"
                className="set-drop"
                data-over={over ? "" : undefined}
                data-disabled={canWrite ? undefined : ""}
                disabled={!canWrite}
                onClick={() => file.current?.click()}
                onDragOver={(e) => { if (!canWrite) return; e.preventDefault(); setOver(true) }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files?.[0]) }}
              >
                <strong>{logo ? "Replace logo" : "Upload logo"}</strong>
                <span>Click to choose or drop an image here</span>
              </button>
              {logo && canWrite && <button type="button" className="btn btn-outline" onClick={() => setLogo("")}>Remove logo</button>}
            </span>
          </Field>
          <Field label="Brand colour" htmlFor="brand-color" error={errors.color} required>
            <ColorPicker id="brand-color" aria-label="Brand colour" value={form.color} presets={presets} disabled={!canWrite} readOnly={!canWrite} invalid={!!errors.color} onValueChange={(hex) => { setForm((f) => ({ ...f, color: hex })); setErrors((x) => ({ ...x, color: undefined })) }} />
          </Field>
          {canWrite && (
            <div className="od-form-foot">
              {(chip.toLowerCase() !== color.toLowerCase() || logo !== savedLogo) && <span className="od-field-hint">Previewing. Save to keep these changes.</span>}
              <ActionButton id="brand-save" className="btn btn-primary" onAction={save}>Save branding</ActionButton>
            </div>
          )}
        </form>
        <div className="set-preview" aria-label="Sidebar preview">
          <div className="set-preview-bar">
            <span className={logo ? "set-preview-chip has-logo" : "set-preview-chip"} style={{ background: chip }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logo ? <img src={logo} alt="" /> : initialsOf(form.name)}
            </span>
            <span className="set-preview-name">{form.name.trim() || "Your company"}</span>
          </div>
          <p className="od-field-hint">Live preview of the sidebar logo</p>
        </div>
      </div>
    </section>
  )
}
