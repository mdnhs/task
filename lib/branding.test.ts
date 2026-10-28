import { describe, expect, it } from "vitest"

import { MAX_LOGO_BYTES, initialsOf, isLogoDataUrl, logoError } from "./branding"

describe("logoError", () => {
  it("accepts allowed types within the limit", () => {
    for (const type of ["image/png", "image/jpeg", "image/svg+xml", "image/webp"]) expect(logoError({ type, size: 1000 })).toBeNull()
    expect(logoError({ type: "image/png", size: MAX_LOGO_BYTES })).toBeNull()
  })
  it("rejects other types", () => {
    expect(logoError({ type: "image/gif", size: 10 })).toMatch(/PNG, JPG, SVG or WebP/)
    expect(logoError({ type: "application/pdf", size: 10 })).not.toBeNull()
  })
  it("rejects files over 512 KB", () => {
    expect(logoError({ type: "image/png", size: MAX_LOGO_BYTES + 1 })).toMatch(/512 KB/)
  })
})

describe("initialsOf", () => {
  it("takes up to two initials", () => {
    expect(initialsOf("Acme Retail Group")).toBe("AR")
    expect(initialsOf("  northwind ")).toBe("N")
    expect(initialsOf("")).toBe("?")
  })
})

describe("isLogoDataUrl", () => {
  it("only accepts image data URLs", () => {
    expect(isLogoDataUrl("data:image/png;base64,AAAA")).toBe(true)
    expect(isLogoDataUrl("data:text/html;base64,AAAA")).toBe(false)
    expect(isLogoDataUrl("https://x.test/a.png")).toBe(false)
    expect(isLogoDataUrl(undefined)).toBe(false)
  })
})
