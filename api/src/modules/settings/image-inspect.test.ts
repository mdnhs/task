import { describe, expect, test } from "vitest"
import { ico, jpeg, png, SVG, webp } from "./image-fixtures"
import { canonicalMime, ImageRejected, inspectBrandingImage, maxBytesOf } from "./image-inspect"

const code = (f: () => unknown): string | null => {
  try {
    f()
    return null
  } catch (e) {
    return e instanceof ImageRejected ? e.code : `other:${String(e)}`
  }
}
const logo = (mime: string, b: Buffer) => () => inspectBrandingImage("logo", mime, b)
const fav = (mime: string, b: Buffer) => () => inspectBrandingImage("favicon", mime, b)

describe("logo", () => {
  test("accepts PNG, JPEG and WebP of any aspect ratio and reports the real size", () => {
    expect(inspectBrandingImage("logo", "image/png", png(200, 64))).toEqual({ mime: "image/png", width: 200, height: 64 })
    expect(inspectBrandingImage("logo", "image/jpeg", jpeg(300, 120))).toEqual({ mime: "image/jpeg", width: 300, height: 120 })
    for (const k of ["VP8X", "VP8L", "VP8 "] as const) expect(inspectBrandingImage("logo", "image/webp", webp(160, 48, k))).toEqual({ mime: "image/webp", width: 160, height: 48 })
  })
  test("refuses SVG by mime and by content, whatever the declared type", () => {
    expect(code(logo("image/svg+xml", SVG))).toBe("image_type_mismatch")
    expect(code(logo("image/png", SVG))).toBe("image_suspicious")
    expect(code(logo("image/jpeg", SVG))).toBe("image_suspicious")
    expect(code(logo("image/webp", SVG))).toBe("image_suspicious")
    // an SVG with no script still is not one of the three raster formats
    expect(code(logo("image/png", Buffer.from('<?xml version="1.0"?><x/>')))).toBe("image_suspicious")
    expect(code(logo("image/png", Buffer.from("  <g></g>                                      ")))).toBe("image_type_mismatch")
  })
  test("the declared type must be the real type (magic bytes), a favicon type is not a logo type", () => {
    expect(code(logo("image/jpeg", png(64, 64)))).toBe("image_type_mismatch")
    expect(code(logo("image/png", jpeg(64, 64)))).toBe("image_type_mismatch")
    expect(code(logo("image/webp", png(64, 64)))).toBe("image_type_mismatch")
    expect(code(logo("image/x-icon", ico([32])))).toBe("image_type_mismatch")
    expect(code(logo("image/gif", Buffer.from("GIF89a....................")))).toBe("image_type_mismatch")
    expect(code(logo("image/png", Buffer.from("not an image at all, just text")))).toBe("image_type_mismatch")
  })
  test("size bounds: each side 32..4096", () => {
    expect(code(logo("image/png", png(31, 100)))).toBe("image_dimensions")
    expect(code(logo("image/png", png(100, 31)))).toBe("image_dimensions")
    expect(code(logo("image/jpeg", jpeg(5000, 100)))).toBe("image_dimensions")
    expect(code(logo("image/png", png(32, 32)))).toBeNull()
    expect(code(logo("image/jpeg", jpeg(4096, 4096)))).toBeNull()
  })
  test("more than 1 MB is refused", () => {
    expect(maxBytesOf("logo")).toBe(1024 * 1024)
    expect(code(logo("image/png", Buffer.concat([png(64, 64), Buffer.alloc(1024 * 1024)])))).not.toBeNull()
  })
})

describe("favicon", () => {
  test("accepts a square PNG 32..512 and a square ICO", () => {
    expect(inspectBrandingImage("favicon", "image/png", png(64, 64))).toEqual({ mime: "image/png", width: 64, height: 64 })
    expect(code(fav("image/png", png(32, 32)))).toBeNull()
    expect(code(fav("image/png", png(512, 512)))).toBeNull()
    expect(inspectBrandingImage("favicon", "image/x-icon", ico([16, 32, 48]))).toEqual({ mime: "image/x-icon", width: 48, height: 48 })
    expect(inspectBrandingImage("favicon", "image/vnd.microsoft.icon", ico([256]))).toEqual({ mime: "image/x-icon", width: 256, height: 256 })
  })
  test("not square is refused for PNG and ICO", () => {
    expect(code(fav("image/png", png(64, 48)))).toBe("image_not_square")
    expect(code(fav("image/x-icon", ico([32], { entryW: 16 })))).toBe("image_not_square")
  })
  test("PNG outside 32..512 is refused", () => {
    expect(code(fav("image/png", png(16, 16)))).toBe("image_dimensions")
    expect(code(fav("image/png", png(1024, 1024)))).toBe("image_dimensions")
  })
  test("JPEG and WebP are not favicon types; SVG never", () => {
    expect(code(fav("image/jpeg", jpeg(64, 64)))).toBe("image_type_mismatch")
    expect(code(fav("image/webp", webp(64, 64)))).toBe("image_type_mismatch")
    expect(code(fav("image/svg+xml", SVG))).toBe("image_type_mismatch")
    expect(code(fav("image/png", SVG))).toBe("image_suspicious")
  })
  test("ICO sides outside 16..256 are refused", () => {
    expect(code(fav("image/x-icon", ico([8])))).toBe("image_dimensions")
  })
  test("256 KB cap constant", () => expect(maxBytesOf("favicon")).toBe(256 * 1024))
})

describe("corrupt and polyglot files", () => {
  test("a PNG with a bad CRC and a truncated PNG are corrupt", () => {
    const bad = Buffer.from(png(64, 64))
    bad[bad.length - 20] ^= 0xff
    expect(code(logo("image/png", bad))).toBe("image_corrupt")
    expect(code(logo("image/png", png(64, 64).subarray(0, 60)))).toBe("image_corrupt")
  })
  test("bytes after IEND are refused (PNG + ZIP, PNG + HTML)", () => {
    expect(code(logo("image/png", png(64, 64, { trailing: Buffer.from("PK\x03\x04zipdata") })))).toBe("image_suspicious")
    expect(code(fav("image/png", png(64, 64, { trailing: Buffer.from("\n<html><body>x</body></html>") })))).toBe("image_suspicious")
  })
  test("markup or script inside the image is refused (PNG text chunk, JPEG comment)", () => {
    expect(code(logo("image/png", png(64, 64, { extraChunk: Buffer.from("x<script>alert(1)</script>") })))).toBe("image_suspicious")
    expect(code(logo("image/png", png(64, 64, { extraChunk: Buffer.from("<svg onload=alert(1)>") })))).toBe("image_suspicious")
    expect(code(logo("image/jpeg", jpeg(64, 64, { comment: "<?php system($_GET[1]); ?>" })))).toBe("image_suspicious")
    expect(code(logo("image/jpeg", jpeg(64, 64, { comment: "javascript:alert(1)" })))).toBe("image_suspicious")
  })
  test("JPEG must end with EOI; trailing bytes are refused", () => {
    expect(code(logo("image/jpeg", jpeg(64, 64, { trailing: Buffer.from("PK\x03\x04") })))).toBe("image_corrupt")
    expect(code(logo("image/jpeg", jpeg(64, 64).subarray(0, 30)))).toBe("image_corrupt")
  })
  test("WebP: RIFF size must match the real length", () => {
    expect(code(logo("image/webp", webp(64, 64, "VP8X", { trailing: Buffer.from("zzzzzz") })))).toBe("image_corrupt")
    expect(code(logo("image/webp", webp(64, 64, "VP8X", { lieAboutSize: true })))).toBe("image_corrupt")
  })
  test("ICO with bytes after the last image is refused; a directory that points outside the file is corrupt", () => {
    expect(code(fav("image/x-icon", ico([32], { trailing: Buffer.from("PK\x03\x04junk") })))).toBe("image_suspicious")
    const lying = Buffer.from(ico([32]))
    lying.writeUInt32LE(0x7fffffff, 6 + 8)
    expect(code(fav("image/x-icon", lying))).toBe("image_corrupt")
  })
  test("an empty buffer and degenerate bytes never throw anything but ImageRejected", () => {
    for (const b of [Buffer.alloc(0), Buffer.alloc(40), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0xff, 0xd8, 0xff, 0xd9])]) {
      for (const m of ["image/png", "image/jpeg", "image/webp", "image/x-icon"]) expect(code(() => inspectBrandingImage("favicon", m, b))).toMatch(/^image_/)
    }
  })
  test("canonicalMime", () => {
    expect(canonicalMime("favicon", "IMAGE/VND.MICROSOFT.ICON")).toBe("image/x-icon")
    expect(canonicalMime("logo", "image/x-icon")).toBeNull()
    expect(canonicalMime("logo", "image/svg+xml")).toBeNull()
  })
})
