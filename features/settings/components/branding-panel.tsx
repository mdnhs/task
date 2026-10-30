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
import { APPEARANCE_OPTIONS, DEFAULT_APPEARANCE, appearanceCss, type Appearance } from "@/lib/appearance"
import { BRAND_STYLE_ID, brandCss } from "@/lib/brand"
import { LOGO_ACCEPT, initialsOf, isLogoDataUrl, logoError } from "@/lib/branding"
const schema = z.object({
  name: z.string().trim().min(2, "Enter the display name").max(60, "Keep the name under 60 characters"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6 digit hex colour, like #2f6f5e"),
})

// Branding (FR-SAAS-11): name, logo and brand colour with a live preview of the sidebar logo chip.
export function BrandingPanel({ tenantId, name, color, appearance, presets, canWrite }: { tenantId: string; name: string; color: string; appearance: Appearance; presets: string[]; canWrite: boolean }) {
  const [form, setForm] = useState({ name, color })
  const [look, setLook] = useState<Appearance>(appearance)
  const [savedLogo, saveLogo] = useTenantLogo(tenantId)
  const [logo, setLogo] = useState<string>(savedLogo)
  const [over, setOver] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; color?: string; logo?: string }>({})
  const file = useRef<HTMLInputElement>(null)
  const valid = /^#[0-9a-fA-F]{6}$/.test(form.color)
  const chip = valid ? form.color : color
  const saved = useRef({ color, appearance })

  // Live preview: the whole app takes the picked colour and appearance at once. Leaving without saving puts the saved look back.
  useEffect(() => {
    saved.current = { color, appearance }
  }, [color, appearance])
  useEffect(() => {
    const el = document.getElementById(BRAND_STYLE_ID)
    if (el) el.textContent = brandCss(chip) + appearanceCss(look)
  }, [chip, look])
  useEffect(() => () => {
    const el = document.getElementById(BRAND_STYLE_ID)
    if (el) el.textContent = brandCss(saved.current.color) + appearanceCss(saved.current.appearance)
  }, [])
  const lookChanged = (Object.keys(look) as (keyof Appearance)[]).some((k) => look[k] !== appearance[k])
  const lookDefault = (Object.keys(look) as (keyof Appearance)[]).every((k) => look[k] === DEFAULT_APPEARANCE[k])

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
    const r = await saveBranding({ ...parsed.data, appearance: look })
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
          <AppearancePicker value={look} disabled={!canWrite} onChange={setLook} onReset={lookDefault ? undefined : () => setLook(DEFAULT_APPEARANCE)} />
          {canWrite && (
            <div className="od-form-foot">
              {(chip.toLowerCase() !== color.toLowerCase() || logo !== savedLogo || lookChanged) && <span className="od-field-hint">Previewing. Save to keep these changes.</span>}
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

const GROUPS = [
  { key: "corners", label: "Corners" },
  { key: "text", label: "Text size" },
  { key: "spacing", label: "Spacing" },
] as const

// Workspace appearance presets (spec 2026-10-30-appearance-presets-design.md): one pill row per setting, native radios.
function AppearancePicker({ value, disabled, onChange, onReset }: { value: Appearance; disabled: boolean; onChange: (a: Appearance) => void; onReset?: () => void }) {
  return (
    <div className="set-appear">
      <div className="set-appear-head">
        <span className="od-field-label">Appearance</span>
        {onReset && !disabled && <button type="button" className="set-appear-reset" onClick={onReset}>Reset to default</button>}
      </div>
      {GROUPS.map((g) => (
        <fieldset key={g.key} className="set-appear-row" disabled={disabled}>
          <legend>{g.label}</legend>
          <div className="set-appear-opts">
            {APPEARANCE_OPTIONS[g.key].map((o) => (
              <label key={o.value} className="set-opt">
                <input type="radio" className="sr-only" name={`appear-${g.key}`} value={o.value} checked={value[g.key] === o.value} onChange={() => onChange({ ...value, [g.key]: o.value })} />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  )
}
