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
import { brandAssetUrl, initialsOf } from "@/lib/branding"
import { fieldErrorOf } from "../adapters"
import { makeSettingsClient } from "../client"
import type { Branding } from "../types"
import { BrandAssetCard } from "./brand-asset-card"

const schema = z.object({ color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a 6 digit hex colour, like #2f6f5e") })

// Branding (FR-SAAS-11): the brand colour with a live preview of the sidebar mark, then one card each for the organization logo and favicon (BrandAssetCard: upload, replace, remove).
// The colour is saved with GET/PUT /v1/settings/branding; the logo and favicon have their own routes and are live as soon as they are scanned clean.
// The appearance presets and a separate display name have no backend (the company name is edited on the Organisation tab).
export function BrandingPanel({ name, color, branding, presets, canWrite }: { name: string; color: string; branding: Branding; presets: string[]; canWrite: boolean }) {
  const run = useApiAction()
  const client = makeSettingsClient(apiBrowser, { go: (u) => window.location.assign(u) })
  const [value, setValue] = useState(color)
  const [assets, setAssets] = useState(branding)
  const [errors, setErrors] = useState<{ color?: string }>({})
  const valid = /^#[0-9a-fA-F]{6}$/.test(value)
  const chip = valid ? value : color
  const saved = useRef(color)

  // The server answer after a refresh is the truth: take it when it changes.
  const [seen, setSeen] = useState(branding)
  if (branding !== seen) {
    setSeen(branding)
    setAssets(branding)
  }

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

  // ActionButton drives the feedback: spinner while the call runs, then a tick. `false` = not saved (no tick).
  async function save() {
    const parsed = schema.safeParse({ color: value })
    if (!parsed.success) {
      setErrors({ color: parsed.error.issues[0]?.message })
      return false
    }
    const r = await run("branding", () => client.saveBranding({ color: parsed.data.color }), {
      handled: (e) => {
        const f = fieldErrorOf(e)
        if (!f) return false
        setErrors({ color: f.message })
        return true
      },
    })
    if (r.ok) toast.success("Branding saved", { description: name })
    return r.ok
  }

  return (
    <>
      <section className="card set-card" aria-labelledby="set-brand-h" data-readonly={canWrite ? undefined : ""}>
        <div className="card-head">
          <div>
            <h2 id="set-brand-h">Branding</h2>
            <div className="sub">How your workspace looks to your team</div>
          </div>
        </div>
        <div className="set-brand">
          <form className="od-form set-form" noValidate onSubmit={(e) => { e.preventDefault(); document.getElementById("brand-save")?.click() }}>
            <FormSection icon="palette" title="Colour">
              <Field label="Brand colour" htmlFor="brand-color" error={errors.color} required>
                <ColorPicker id="brand-color" aria-label="Brand colour" value={value} presets={presets} disabled={!canWrite} readOnly={!canWrite} invalid={!!errors.color} onValueChange={(hex) => { setValue(hex); setErrors((x) => ({ ...x, color: undefined })) }} />
              </Field>
            </FormSection>
            {canWrite && (
              <div className="od-form-foot">
                {chip.toLowerCase() !== color.toLowerCase() && <span className="od-field-hint">Previewing. Save to keep this colour.</span>}
                <ActionButton id="brand-save" className="btn btn-primary" onAction={save}>Save branding</ActionButton>
              </div>
            )}
          </form>
          <div className="set-preview" aria-label="Sidebar preview">
            <div className="set-preview-bar">
              <span className={assets.logo ? "set-preview-chip has-logo" : "set-preview-chip"}>
                {assets.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a same-origin, version-pinned image
                  <img src={brandAssetUrl("logo", assets.logo.version)} alt="" />
                ) : (
                  initialsOf(name)
                )}
              </span>
              <span className="set-preview-name">{name.trim() || "Your company"}</span>
            </div>
            <p className="od-field-hint">Live preview of the sidebar logo</p>
          </div>
        </div>
      </section>
      <div className="set-assets">
        <BrandAssetCard kind="logo" asset={assets.logo} storageReady={assets.storageReady} canWrite={canWrite} orgName={name} onChange={setAssets} />
        <BrandAssetCard kind="favicon" asset={assets.favicon} storageReady={assets.storageReady} canWrite={canWrite} orgName={name} onChange={setAssets} />
      </div>
    </>
  )
}
