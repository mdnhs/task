import { crc32, deflateSync } from "node:zlib"

// Test-only builders of tiny, structurally valid images (no library). Used by the image inspector and the branding API tests.

const chunk = (type: string, data: Buffer): Buffer => {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, "latin1")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

export function png(w: number, h: number, o: { trailing?: Buffer; extraChunk?: Buffer } = {}): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2 // truecolour
  const row = Buffer.alloc(1 + w * 3)
  const raw = Buffer.alloc(row.length * h)
  const parts: Buffer[] = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)]
  if (o.extraChunk) parts.push(chunk("tEXt", o.extraChunk))
  parts.push(chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)))
  if (o.trailing) parts.push(o.trailing)
  return Buffer.concat(parts)
}

export function jpeg(w: number, h: number, o: { trailing?: Buffer; comment?: string } = {}): Buffer {
  const sof: Buffer = Buffer.from([0xff, 0xc0, 0, 11, 8, h >> 8, h & 255, w >> 8, w & 255, 1, 1, 0x11, 0])
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0])]
  if (o.comment !== undefined) {
    const c = Buffer.from(o.comment, "latin1")
    parts.push(Buffer.from([0xff, 0xfe, (c.length + 2) >> 8, (c.length + 2) & 255]), c)
  }
  parts.push(sof, Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 1, 2, 3]), Buffer.from([0xff, 0xd9]))
  if (o.trailing) parts.push(o.trailing)
  return Buffer.concat(parts)
}

export function webp(w: number, h: number, kind: "VP8X" | "VP8L" | "VP8 " = "VP8X", o: { trailing?: Buffer; lieAboutSize?: boolean } = {}): Buffer {
  const body = Buffer.alloc(10)
  if (kind === "VP8X") {
    body.writeUIntLE(w - 1, 4, 3)
    body.writeUIntLE(h - 1, 7, 3)
  } else if (kind === "VP8L") {
    body[0] = 0x2f
    body.writeUInt32LE((w - 1) | ((h - 1) << 14), 1)
  } else {
    body.set([0, 0, 0, 0x9d, 0x01, 0x2a], 0)
    body.writeUInt16LE(w, 6)
    body.writeUInt16LE(h, 8)
  }
  const ck = Buffer.concat([Buffer.from(kind, "latin1"), Buffer.from([body.length, 0, 0, 0]), body])
  const riff = Buffer.concat([Buffer.from("WEBP", "latin1"), ck])
  const head = Buffer.alloc(8)
  head.write("RIFF", 0, "latin1")
  head.writeUInt32LE(riff.length + (o.lieAboutSize ? 99 : 0), 4)
  return Buffer.concat([head, riff, o.trailing ?? Buffer.alloc(0)])
}

/** An ICO whose entries are PNGs of the given sides (a side of 256 is written as 0, as the format says). */
export function ico(sides: number[], o: { trailing?: Buffer; entryW?: number } = {}): Buffer {
  const imgs = sides.map((s) => png(s, s))
  const dir = Buffer.alloc(6 + sides.length * 16)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(sides.length, 4)
  let off = dir.length
  sides.forEach((s, i) => {
    const e = 6 + i * 16
    const w = o.entryW ?? s
    dir[e] = w === 256 ? 0 : w
    dir[e + 1] = s === 256 ? 0 : s
    dir.writeUInt32LE(imgs[i].length, e + 8)
    dir.writeUInt32LE(off, e + 12)
    off += imgs[i].length
  })
  return Buffer.concat([dir, ...imgs, o.trailing ?? Buffer.alloc(0)])
}

export const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><script>alert(1)</script></svg>')
