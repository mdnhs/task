import { describe, expect, test } from "vitest"
import { BRAND_ASSET_RULES, brandAssetError, brandAssetMime, brandAssetProblem, brandAssetUrl, faviconIcons, imageHeader, initialsOf } from "./branding"

// Test-only tiny image headers.
const png = (w: number, h: number) => {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}
const ico = (sides: number[]) => {
  const b = new Uint8Array(6 + sides.length * 16)
  b[2] = 1
  b[4] = sides.length
  sides.forEach((s, i) => { b[6 + i * 16] = s === 256 ? 0 : s; b[7 + i * 16] = s === 256 ? 0 : s })
  return b
}
const f = (name: string, type: string, size = 1000) => ({ name, type, size })

describe("initialsOf", () => {
  test("two words, one word, nothing", () => {
    expect(initialsOf("Acme Cleaning Ltd")).toBe("AC")
    expect(initialsOf("acme")).toBe("A")
    expect(initialsOf("  ")).toBe("?")
  })
})

describe("what the upload accepts (mirrors the API: PNG, JPEG, WebP logo up to 1 MB; PNG or ICO favicon up to 256 KB; never SVG)", () => {
  test("the rules", () => {
    expect(BRAND_ASSET_RULES.logo.maxBytes).toBe(1024 * 1024)
    expect(BRAND_ASSET_RULES.favicon.maxBytes).toBe(256 * 1024)
    for (const k of ["logo", "favicon"] as const) expect(BRAND_ASSET_RULES[k].accept).not.toMatch(/svg/i)
  })
  test("the mime sent to the API is chosen from the file, an .ico is image/x-icon whatever the browser says", () => {
    expect(brandAssetMime("logo", f("a.png", "image/png"))).toBe("image/png")
    expect(brandAssetMime("logo", f("a.jpg", "image/jpeg"))).toBe("image/jpeg")
    expect(brandAssetMime("favicon", f("favicon.ico", ""))).toBe("image/x-icon")
    expect(brandAssetMime("favicon", f("favicon.ico", "image/vnd.microsoft.icon"))).toBe("image/x-icon")
    expect(brandAssetMime("favicon", f("f.png", "image/png"))).toBe("image/png")
    expect(brandAssetMime("logo", f("a.svg", "image/svg+xml"))).toBeNull()
    expect(brandAssetMime("logo", f("a.ico", "image/x-icon"))).toBeNull()
    expect(brandAssetMime("favicon", f("a.jpg", "image/jpeg"))).toBeNull()
    expect(brandAssetMime("logo", f("a.gif", "image/gif"))).toBeNull()
  })
  test("wrong type, too big, not square: one short line each", () => {
    expect(brandAssetError("logo", f("a.svg", "image/svg+xml"))).toBe("Use a PNG, JPG or WebP image.")
    expect(brandAssetError("favicon", f("a.jpg", "image/jpeg"))).toBe("Use a square PNG or an ICO file.")
    expect(brandAssetError("logo", f("a.png", "image/png", 1024 * 1024 + 1))).toBe("Too big. The logo can be up to 1 MB.")
    expect(brandAssetError("favicon", f("f.png", "image/png", 256 * 1024 + 1))).toBe("Too big. The favicon can be up to 256 KB.")
    expect(brandAssetError("logo", f("a.png", "image/png", 1024 * 1024), png(200, 50))).toBeNull()
    expect(brandAssetError("favicon", f("f.png", "image/png"), png(64, 48))).toBe("Not square. This image is 64 × 48 px.")
    expect(brandAssetError("favicon", f("f.png", "image/png"), png(64, 64))).toBeNull()
    expect(brandAssetError("favicon", f("f.png", "image/png"), png(16, 16))).toBe("Too small or too large. Use 32 to 512 px.")
    expect(brandAssetError("favicon", f("f.ico", "image/x-icon"), ico([16, 32]))).toBeNull()
    expect(brandAssetError("favicon", f("f.ico", "image/x-icon"), ico([4]))).toBe("Too small or too large. Use 16 to 256 px.")
    expect(brandAssetError("logo", f("a.png", "image/png"), png(20, 100))).toBe("Too small or too large. Use 32 to 4096 px per side.")
  })
  test("imageHeader reads PNG and ICO sizes, nothing else", () => {
    expect(imageHeader(png(120, 40))).toEqual({ width: 120, height: 40 })
    expect(imageHeader(ico([16, 48]))).toEqual({ width: 48, height: 48 })
    expect(imageHeader(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull()
    expect(imageHeader(new Uint8Array(0))).toBeNull()
  })
})

describe("what the API refuses reads as a short line", () => {
  test("codes", () => {
    expect(brandAssetProblem("logo", "image_not_square")).toMatch(/square/i)
    expect(brandAssetProblem("favicon", "image_not_square")).toMatch(/square/i)
    expect(brandAssetProblem("logo", "image_type_mismatch")).toMatch(/not a (real )?(PNG|image)|valid/i)
    expect(brandAssetProblem("logo", "image_suspicious")).toMatch(/extra|clean/i)
    expect(brandAssetProblem("logo", "image_corrupt")).toMatch(/damaged|corrupt|export/i)
    expect(brandAssetProblem("logo", "file_infected")).toMatch(/virus|malware|blocked/i)
    expect(brandAssetProblem("logo", "file_too_large")).toMatch(/1 MB/)
    expect(brandAssetProblem("favicon", "file_too_large")).toMatch(/256 KB/)
    expect(brandAssetProblem("logo", "storage_not_configured")).toMatch(/storage is not set up/i)
    expect(brandAssetProblem("logo", "something_else")).toBeNull()
  })
  test("no tenant-facing line says Tenant", () => {
    for (const code of ["image_not_square", "image_type_mismatch", "image_suspicious", "image_corrupt", "image_dimensions", "file_infected", "file_too_large", "storage_not_configured", "mime_not_allowed", "upload_mismatch"])
      for (const k of ["logo", "favicon"] as const) expect(brandAssetProblem(k, code) ?? "").not.toMatch(/tenant/i)
  })
})

describe("brandAssetUrl", () => {
  test("same-origin BFF path pinned to the version", () => {
    expect(brandAssetUrl("logo", "9f86d081884c7d65")).toBe("/v1/branding/logo?v=9f86d081884c7d65")
    expect(brandAssetUrl("favicon", "a b")).toBe("/v1/branding/favicon?v=a%20b")
  })
})

describe("faviconIcons (the browser tab icon of the company app)", () => {
  test("an uploaded favicon is the tab icon, version-pinned with its type; none keeps the product favicon (no override)", () => {
    expect(faviconIcons({ version: "abc", mime: "image/png" })).toEqual({ icon: [{ url: "/v1/branding/favicon?v=abc", type: "image/png" }], shortcut: ["/v1/branding/favicon?v=abc"] })
    expect(faviconIcons({ version: "abc", mime: "image/x-icon" })!.icon[0]).toMatchObject({ type: "image/x-icon" })
    expect(faviconIcons(null)).toBeUndefined()
    expect(faviconIcons(undefined)).toBeUndefined()
  })
})
