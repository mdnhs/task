"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useRouter } from "next/navigation"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { Icon } from "@/components/icon"
import { apiBrowser } from "@/lib/api/browser"
import { ApiError, userMessage } from "@/lib/api/problem"
import { BRAND_ASSET_RULES, brandAssetError, brandAssetProblem, brandAssetUrl, type BrandAsset, type BrandAssetKind } from "@/lib/branding"
import { makeSettingsClient, type UploadStage } from "../client"
import type { Branding } from "../types"

const STAGE_TEXT: Record<UploadStage, string> = { uploading: "Uploading", checking: "Checking the image", scanning: "Scanning for viruses", saving: "Saving" }
const FORMAT: Record<string, string> = { "image/png": "PNG", "image/jpeg": "JPG", "image/webp": "WebP", "image/x-icon": "ICO" }
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

/** What went wrong, as one short line. The API's image codes first, then the generic copy. */
function errorLine(kind: BrandAssetKind, e: unknown): string {
  if (e instanceof ApiError) return brandAssetProblem(kind, e.code) ?? userMessage(e).text
  if (e instanceof Error && /took too long/.test(e.message)) return "The scan is taking long. Check back in a minute."
  return "The upload failed. Try again."
}

// Settings -> Branding: one card per organization image (logo, favicon). Drop or choose a file, see it at once, watch it upload and scan, then it is live (sidebar, browser tab).
// The type, size and squareness are checked before the upload starts; the API checks the real bytes again. SVG is never accepted. With no file storage set up the card says so
// instead of offering an upload that cannot work.
export function BrandAssetCard({ kind, asset, storageReady, canWrite, orgName, onChange }: { kind: BrandAssetKind; asset: BrandAsset | null; storageReady: boolean; canWrite: boolean; orgName: string; onChange: (b: Branding) => void }) {
  const rule = BRAND_ASSET_RULES[kind]
  const id = useId()
  const router = useRouter()
  const client = makeSettingsClient(apiBrowser, { go: () => undefined }) // uploads never navigate
  const input = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<UploadStage | null>(null)
  const [pct, setPct] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)
  const [ask, setAsk] = useState(false)
  const [saved, setSaved] = useState(false)
  const [noStorage, setNoStorage] = useState(false)
  const [local, setLocal] = useState<string | null>(null) // object URL of the picked file: the instant preview while it uploads
  const busy = stage !== null
  const off = !storageReady || noStorage

  useEffect(() => () => { if (local) URL.revokeObjectURL(local) }, [local])
  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), 2600)
    return () => clearTimeout(t)
  }, [saved])

  const shown = local ?? (asset ? brandAssetUrl(kind, asset.version) : null)

  async function finish(b: Branding) {
    onChange(b)
    setSaved(true)
    router.refresh() // the shell (sidebar logo) and the page head (tab icon) read the saved version
  }

  async function pick(f: File | undefined) {
    if (!f || !canWrite || busy || off) return
    setError(null)
    const head = new Uint8Array(await f.slice(0, 64).arrayBuffer())
    const pre = brandAssetError(kind, f, head)
    if (pre) return setError(pre)
    setLocal(URL.createObjectURL(f))
    setPct(0)
    try {
      await finish(await client.uploadBrandAsset(kind, f, { onStage: setStage, onProgress: setPct }))
    } catch (e) {
      if (e instanceof ApiError && e.code === "storage_not_configured") setNoStorage(true)
      setError(errorLine(kind, e))
    } finally {
      setStage(null)
      setLocal(null) // the saved copy (or the previous one) is what shows now
    }
  }

  async function remove() {
    setError(null)
    setStage("saving")
    try {
      await finish(await client.removeBrandAsset(kind))
    } catch (e) {
      setError(errorLine(kind, e))
    } finally {
      setStage(null)
    }
  }

  const title = rule.label
  return (
    <section className="card set-card set-asset" aria-labelledby={`${id}-h`} data-kind={kind} data-state={stage ?? (off ? "off" : "idle")} data-readonly={canWrite ? undefined : ""}>
      <div className="card-head">
        <div>
          <h2 id={`${id}-h`}>{title}</h2>
          <div className="sub">{rule.requirement}</div>
        </div>
        {asset && canWrite && !off && !busy && (
          <button type="button" className="btn btn-outline set-asset-rm" onClick={() => setAsk(true)}>
            <Icon name="trash" />
            Remove
          </button>
        )}
        {saved && (
          <span className="set-saved" role="status">
            <Icon name="check" />
            Saved
          </span>
        )}
      </div>
      <div className="set-asset-body">
        <div className="set-asset-view" data-kind={kind} data-empty={shown ? undefined : ""} data-busy={busy ? "" : undefined}>
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- a same-origin, version-pinned, already scanned image (or the picked file's object URL): next/image would only re-encode it
            <img src={shown} alt={asset || local ? `${title} preview` : ""} />
          ) : (
            <Icon name="image" />
          )}
        </div>
        <div className="set-asset-main">
          {off ? (
            <p className="set-asset-off" role="status">
              <Icon name="warning" />
              <span>
                <strong>Storage is not set up</strong>
                <span>Uploads turn on once file storage is set up for this installation.</span>
              </span>
            </p>
          ) : canWrite ? (
            <>
              <input ref={input} id={`${id}-in`} type="file" accept={rule.accept} className="sr-only" tabIndex={-1} aria-label={`Choose a ${kind} file`} disabled={busy} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = "" }} />
              <button
                type="button"
                className="set-drop"
                data-over={over ? "" : undefined}
                disabled={busy}
                onClick={() => input.current?.click()}
                onDragOver={(e) => { if (busy) return; e.preventDefault(); setOver(true) }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => { e.preventDefault(); setOver(false); void pick(e.dataTransfer.files?.[0]) }}
              >
                <strong>
                  <Icon name="upload" />
                  {asset ? `Replace ${kind}` : `Upload ${kind}`}
                </strong>
                <span>Drop an image or click</span>
              </button>
            </>
          ) : (
            <p className="od-field-hint">Only an owner or admin can change this.</p>
          )}
          {error && (
            <p className="od-field-err set-asset-err" role="alert">
              {error}
            </p>
          )}
          {/* one fixed-height row (the loading skeleton's third block): the upload progress, or what is live now, or that nothing is */}
          <div className="set-asset-slot">
            {busy ? (
              <div className="set-asset-prog" role="status" aria-live="polite">
                <div className="set-asset-bar" data-indeterminate={stage !== "uploading" ? "" : undefined}>
                  <i style={{ ["--p" as string]: stage === "uploading" ? pct : 1 }} />
                </div>
                <span>{stage === "uploading" ? `${STAGE_TEXT.uploading} ${Math.round(pct * 100)}%` : STAGE_TEXT[stage!]}</span>
              </div>
            ) : asset ? (
              <div className="set-asset-meta">
                <span>
                  {FORMAT[asset.mime] ?? "Image"} · {asset.width} × {asset.height} · {kb(asset.sizeBytes)}
                </span>
                {kind === "favicon" && shown && (
                  <span className="set-fav-tab" aria-label="How it looks in a browser tab">
                    {/* eslint-disable-next-line @next/next/no-img-element -- see above */}
                    <img src={shown} alt="" />
                    <span>{orgName.trim() || "Your company"}</span>
                  </span>
                )}
              </div>
            ) : (
              <p className="od-field-hint set-asset-none">{`No ${kind} yet`}</p>
            )}
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={ask}
        onOpenChange={setAsk}
        title={`Remove the ${kind}?`}
        text={kind === "logo" ? "The sidebar goes back to the check mark." : "Browser tabs go back to the OpsDesk icon."}
        confirmLabel="Remove"
        destructive
        onConfirm={() => void remove()}
      />
    </section>
  )
}
