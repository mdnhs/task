// Pure branding helpers (FR-SAAS-11). Server-safe: no React, no stores. The client store is hooks/use-branding.ts.

export const LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"] as const
export const LOGO_ACCEPT = LOGO_TYPES.join(",")
export const MAX_LOGO_BYTES = 512 * 1024

export function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?"
}

// Returns the inline error to show, or null when the file is acceptable.
export function logoError(file: { type: string; size: number }): string | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return "Use a PNG, JPG, SVG or WebP image"
  if (file.size > MAX_LOGO_BYTES) return "Keep the logo under 512 KB"
  return null
}

// Only image data URLs of the allowed types are ever rendered as a logo.
export function isLogoDataUrl(v: unknown): v is string {
  return typeof v === "string" && /^data:image\/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$/.test(v)
}
