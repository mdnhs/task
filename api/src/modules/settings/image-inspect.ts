import { crc32 } from "node:zlib"

/**
 * Strict inspection of an uploaded organization logo or favicon. Pure (bytes in, verdict out), no image library: the header of each
 * format is parsed by hand, the container structure is walked to its end, and anything that is not exactly the declared format is refused.
 *
 * Never trusted: the client's mime, name or size. Only raster formats are accepted. SVG is refused everywhere (it carries script) and a
 * file that merely STARTS like an image but carries markup or trailing bytes (a polyglot) is refused too.
 */

export type BrandingKind = "logo" | "favicon"
export const BRANDING_KINDS = ["logo", "favicon"] as const

export const LOGO_MIMES = ["image/png", "image/jpeg", "image/webp"] as const
export const ICO_MIMES = ["image/x-icon", "image/vnd.microsoft.icon"] as const
export const FAVICON_MIMES = ["image/png", ...ICO_MIMES] as const
export const LOGO_MAX_BYTES = 1024 * 1024
export const FAVICON_MAX_BYTES = 256 * 1024

/** Logo: any aspect ratio, each side within these bounds. */
export const LOGO_MIN_PX = 32
export const LOGO_MAX_PX = 4096
/** Favicon PNG: square, each side within these bounds. An ICO is a set of square images of 16..256 px. */
export const FAVICON_PNG_MIN_PX = 32
export const FAVICON_PNG_MAX_PX = 512
export const ICO_MIN_PX = 16
export const ICO_MAX_PX = 256

export type ImageErrorCode = "image_type_mismatch" | "image_corrupt" | "image_not_square" | "image_dimensions" | "image_suspicious"
export class ImageRejected extends Error {
  constructor(readonly code: ImageErrorCode) {
    super(code)
    this.name = "ImageRejected"
  }
}
const reject = (code: ImageErrorCode): never => {
  throw new ImageRejected(code)
}

export type ImageInfo = { mime: "image/png" | "image/jpeg" | "image/webp" | "image/x-icon"; width: number; height: number }

/** The declared mime in its canonical spelling (the ICO mime has two), or null when this kind does not take it. */
export function canonicalMime(kind: BrandingKind, declared: string): ImageInfo["mime"] | null {
  const m = declared.trim().toLowerCase()
  if (kind === "logo") return (LOGO_MIMES as readonly string[]).includes(m) ? (m as ImageInfo["mime"]) : null
  if (m === "image/png") return "image/png"
  return (ICO_MIMES as readonly string[]).includes(m) ? "image/x-icon" : null
}
export const maxBytesOf = (kind: BrandingKind): number => (kind === "logo" ? LOGO_MAX_BYTES : FAVICON_MAX_BYTES)

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// Markup or script anywhere in the bytes of an "image": compressed pixel data never spells these, a polyglot has to.
const MARKUP = /<\s*(?:script|svg|html|iframe|object|embed|body|\?php|!doctype)|javascript\s*:/i // `<?xml` is deliberately NOT here: editors write XMP (`<?xml ...?><x:xmpmeta>`) into PNG iTXt, JPEG APP1 and WebP chunks

function inspectPng(b: Buffer): { width: number; height: number } {
  if (b.length < 33 || !b.subarray(0, 8).equals(PNG_SIG)) return reject("image_type_mismatch")
  let at = 8
  let width = 0
  let height = 0
  let first = true
  let sawData = false
  for (;;) {
    if (at + 12 > b.length) return reject("image_corrupt")
    const len = b.readUInt32BE(at)
    const type = b.subarray(at + 4, at + 8).toString("latin1")
    const end = at + 8 + len
    if (len > 0x7fffffff || end + 4 > b.length) return reject("image_corrupt")
    if (b.readUInt32BE(end) !== crc32(b.subarray(at + 4, end))) return reject("image_corrupt")
    if (first) {
      if (type !== "IHDR" || len !== 13) return reject("image_corrupt")
      width = b.readUInt32BE(at + 8)
      height = b.readUInt32BE(at + 12)
      first = false
    } else if (type === "IDAT") sawData = true
    at = end + 4
    if (type === "IEND") {
      if (len !== 0 || !sawData) return reject("image_corrupt")
      if (at !== b.length) return reject("image_suspicious") // anything after IEND (an archive, a script) is a polyglot
      return { width, height }
    }
  }
}

function inspectJpeg(b: Buffer): { width: number; height: number } {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return reject("image_type_mismatch")
  if (b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return reject("image_corrupt") // must end with EOI, no trailing bytes
  let at = 2
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return reject("image_corrupt")
    let marker = b[at + 1]
    while (marker === 0xff && at + 2 < b.length) {
      at++
      marker = b[at + 1]
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += 2
      continue
    }
    if (marker === 0xd9) return reject("image_corrupt") // EOI before any frame header
    const len = b.readUInt16BE(at + 2)
    if (len < 2 || at + 2 + len > b.length) return reject("image_corrupt")
    const sof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (sof) {
      if (len < 8) return reject("image_corrupt")
      const height = b.readUInt16BE(at + 5)
      const width = b.readUInt16BE(at + 7)
      if (width === 0 || height === 0) return reject("image_corrupt")
      return { width, height }
    }
    if (marker === 0xda) return reject("image_corrupt") // scan data before a frame header
    at += 2 + len
  }
  return reject("image_corrupt")
}

function inspectWebp(b: Buffer): { width: number; height: number } {
  if (b.length < 30 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") return reject("image_type_mismatch")
  if (b.readUInt32LE(4) + 8 !== b.length) return reject("image_corrupt") // the RIFF size must be the real size: no trailing bytes, no truncation
  const fourcc = b.toString("latin1", 12, 16)
  if (fourcc === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) }
  if (fourcc === "VP8L") {
    if (b[20] !== 0x2f) return reject("image_corrupt")
    const bits = b.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  if (fourcc === "VP8 ") {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return reject("image_corrupt")
    return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff }
  }
  return reject("image_corrupt")
}

/** An ICO: the directory's entries must all be square, 16..256 px, point inside the file and hold a PNG or a bitmap. Returns the LARGEST entry. */
function inspectIco(b: Buffer): { width: number; height: number } {
  if (b.length < 22 || b.readUInt16LE(0) !== 0 || b.readUInt16LE(2) !== 1) return reject("image_type_mismatch")
  const count = b.readUInt16LE(4)
  if (count < 1 || count > 16 || 6 + count * 16 > b.length) return reject("image_corrupt")
  let best = 0
  let end = 6 + count * 16
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16
    const w = b[e] || 256
    const h = b[e + 1] || 256
    const size = b.readUInt32LE(e + 8)
    const offset = b.readUInt32LE(e + 12)
    if (w !== h) return reject("image_not_square")
    if (w < ICO_MIN_PX || w > ICO_MAX_PX) return reject("image_dimensions")
    if (size < 8 || offset < 6 + count * 16 || offset + size > b.length) return reject("image_corrupt")
    const data = b.subarray(offset, offset + size)
    if (data.subarray(0, 8).equals(PNG_SIG)) {
      const p = inspectPng(data) // a PNG inside the ICO obeys the PNG rules too (CRC, no trailing bytes)
      if (p.width !== w || p.height !== h) return reject("image_corrupt")
    } else if (data.readUInt32LE(0) !== 40) return reject("image_corrupt") // a BITMAPINFOHEADER
    end = Math.max(end, offset + size)
    best = Math.max(best, w)
  }
  if (end !== b.length) return reject("image_suspicious") // bytes after the last image
  return { width: best, height: best }
}

/**
 * Verifies `bytes` against the declared `mime` for the given kind and returns what the file really is. Throws ImageRejected with a stable code.
 * Order: markup scan, format by magic bytes (must equal the declared type), structure, then the size rules of the kind.
 */
export function inspectBrandingImage(kind: BrandingKind, declaredMime: string, bytes: Buffer): ImageInfo {
  const mime = canonicalMime(kind, declaredMime)
  if (!mime) return reject("image_type_mismatch")
  if (bytes.length > maxBytesOf(kind)) return reject("image_dimensions")
  if (MARKUP.test(bytes.toString("latin1"))) return reject("image_suspicious")
  const dims = mime === "image/png" ? inspectPng(bytes) : mime === "image/jpeg" ? inspectJpeg(bytes) : mime === "image/webp" ? inspectWebp(bytes) : inspectIco(bytes)
  const { width, height } = dims
  if (kind === "logo") {
    if (width < LOGO_MIN_PX || height < LOGO_MIN_PX || width > LOGO_MAX_PX || height > LOGO_MAX_PX) return reject("image_dimensions")
  } else {
    if (width !== height) return reject("image_not_square")
    if (mime === "image/png" && (width < FAVICON_PNG_MIN_PX || width > FAVICON_PNG_MAX_PX)) return reject("image_dimensions")
  }
  return { mime, width, height }
}
