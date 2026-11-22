// Pure branding helpers (FR-SAAS-11). Server-safe: no React, no stores. The organization logo and favicon rules mirror the API (api/src/modules/settings/image-inspect.ts);
// the API is the authority, this only gives the answer before the upload starts. SVG is never accepted anywhere (script risk).

export type BrandAssetKind = "logo" | "favicon"
/** What the API exposes about a live asset (GET /v1/me/tenant `brand.logo`, GET /v1/settings/branding). `version` pins the cached copy. */
export type BrandAsset = { version: string; mime: string; width: number; height: number; sizeBytes: number }

export const BRAND_ASSET_RULES = {
  logo: { label: "Logo", maxBytes: 1024 * 1024, maxLabel: "1 MB", accept: ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp", requirement: "PNG, JPG or WebP · up to 1 MB · 32 to 4096 px" },
  favicon: { label: "Favicon", maxBytes: 256 * 1024, maxLabel: "256 KB", accept: ".png,.ico,image/png,image/x-icon,image/vnd.microsoft.icon", requirement: "Square PNG (32 to 512 px) or ICO · up to 256 KB" },
} as const

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?"
}

const ext = (name: string) => name.slice(name.lastIndexOf(".") + 1).toLowerCase()

/** The mime to send to the API: the browser's value for PNG, JPEG and WebP, and `image/x-icon` for any .ico (browsers report it as nothing, x-icon or vnd.microsoft.icon). Null = not an accepted type. */
export function brandAssetMime(kind: BrandAssetKind, file: { name: string; type: string }): string | null {
  const t = file.type.toLowerCase()
  if (ext(file.name) === "ico" || t === "image/x-icon" || t === "image/vnd.microsoft.icon") return kind === "favicon" ? "image/x-icon" : null
  if (t === "image/png") return "image/png"
  if (kind === "logo" && (t === "image/jpeg" || t === "image/webp")) return t
  return null
}

/** Size of a PNG (IHDR) or ICO (the largest entry; width and height of the first entry that is not square, when any) from its first bytes. Null for any other format. */
export function imageHeader(b: Uint8Array): { width: number; height: number } | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
    return { width: v.getUint32(16), height: v.getUint32(20) }
  }
  if (b.length >= 22 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) {
    const n = b[4] | (b[5] << 8)
    let best = 0
    for (let i = 0; i < n && 6 + i * 16 + 2 <= b.length; i++) {
      const w = b[6 + i * 16] || 256
      const h = b[7 + i * 16] || 256
      if (w !== h) return { width: w, height: h }
      best = Math.max(best, w)
    }
    return best ? { width: best, height: best } : null
  }
  return null
}

/**
 * The line to show before uploading, or null when the file may go. `head` = the first bytes of the file (PNG and ICO sizes are checked; the other
 * formats are checked by the API). Order: type, size, squareness (favicon), pixel range.
 */
export function brandAssetError(kind: BrandAssetKind, file: { name: string; type: string; size: number }, head?: Uint8Array): string | null {
  const rule = BRAND_ASSET_RULES[kind]
  const mime = brandAssetMime(kind, file)
  if (!mime) return kind === "logo" ? "Use a PNG, JPG or WebP image." : "Use a square PNG or an ICO file."
  if (file.size > rule.maxBytes) return `Too big. The ${kind} can be up to ${rule.maxLabel}.`
  const dim = head ? imageHeader(head) : null
  if (!dim) return null
  const { width, height } = dim
  if (kind === "favicon" && width !== height) return `Not square. This image is ${width} × ${height} px.`
  const ico = mime === "image/x-icon"
  const [lo, hi] = kind === "logo" ? [32, 4096] : ico ? [16, 256] : [32, 512]
  if (width < lo || height < lo || width > hi || height > hi) return kind === "logo" ? `Too small or too large. Use ${lo} to ${hi} px per side.` : `Too small or too large. Use ${lo} to ${hi} px.`
  return null
}

/** The short line for what the API refused (its problem code), or null when the code is not about the image. */
export function brandAssetProblem(kind: BrandAssetKind, code: string): string | null {
  const rule = BRAND_ASSET_RULES[kind]
  switch (code) {
    case "image_not_square": return "Not square. Use a square image."
    case "image_type_mismatch": return kind === "logo" ? "That is not a real PNG, JPG or WebP image." : "That is not a real PNG or ICO file."
    case "image_corrupt": return "The image looks damaged. Export it again."
    case "image_suspicious": return "The file carries extra data. Export a clean image."
    case "image_dimensions": return kind === "logo" ? "Too small or too large. Use 32 to 4096 px per side." : "Too small or too large. Use 32 to 512 px (ICO 16 to 256)."
    case "file_too_large": return `Too big. The ${kind} can be up to ${rule.maxLabel}.`
    case "mime_not_allowed": return kind === "logo" ? "Use a PNG, JPG or WebP image." : "Use a square PNG or an ICO file."
    case "upload_mismatch": return "The upload did not match the file. Try again."
    case "file_infected": return "Blocked. A virus was found in this file."
    case "storage_not_configured": return "Storage is not set up yet."
    default: return null
  }
}

/** Same-origin path of a live asset (served through the BFF with the company cookie); the version pins the browser's cached copy. */
export const brandAssetUrl = (kind: BrandAssetKind, version: string): string => `/v1/branding/${kind}?v=${encodeURIComponent(version)}`

/** Next's metadata icons for the company app: the uploaded favicon (version-pinned, same-origin), or undefined so the product favicon (app/favicon.ico) stays. */
export function faviconIcons(f: Pick<BrandAsset, "version" | "mime"> | null | undefined): { icon: { url: string; type: string }[]; shortcut: string[] } | undefined {
  if (!f) return undefined
  const url = brandAssetUrl("favicon", f.version)
  return { icon: [{ url, type: f.mime }], shortcut: [url] }
}
