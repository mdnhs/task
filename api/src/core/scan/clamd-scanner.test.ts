import net from "node:net"
import { Readable } from "node:stream"
import { afterEach, expect, test } from "vitest"
import { makeClamdScanner, ScanSizeLimitError } from "./clamd-scanner"

/** In-test TCP stub that speaks the clamd INSTREAM protocol (never the real clamav image: too slow for tests). */
type Stub = { port: number; commands: string[]; frames: Buffer[]; sawTerminator: () => boolean; close(): Promise<void> }
async function stub(reply: (received: Buffer) => string | null, o: { limit?: number } = {}): Promise<Stub> {
  const commands: string[] = []
  const frames: Buffer[] = []
  let terminated = false
  const server = net.createServer((sock) => {
    let buf = Buffer.alloc(0)
    let started = false
    let payload = 0
    sock.on("error", () => undefined)
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d])
      if (!started) {
        const nul = buf.indexOf(0)
        if (nul < 0) return
        commands.push(buf.subarray(0, nul).toString())
        buf = buf.subarray(nul + 1)
        started = true
      }
      while (buf.length >= 4) {
        const len = buf.readUInt32BE(0)
        if (len === 0) {
          terminated = true
          const all = Buffer.concat(frames)
          const r = reply(all)
          if (r !== null) sock.end(r + "\0")
          else sock.end()
          return
        }
        if (buf.length < 4 + len) return
        frames.push(Buffer.from(buf.subarray(4, 4 + len)))
        payload += len
        buf = buf.subarray(4 + len)
        if (o.limit && payload > o.limit) {
          sock.end("INSTREAM size limit exceeded. ERROR\0")
          return
        }
      }
    })
  })
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
  return {
    port: (server.address() as net.AddressInfo).port,
    commands,
    frames,
    sawTerminator: () => terminated,
    close: () => new Promise((r) => server.close(() => r())),
  }
}

let open: Stub | undefined
afterEach(async () => {
  await open?.close()
  open = undefined
})

test("clamd client sends zINSTREAM\\0, length-prefixed chunks and a zero terminator, and parses 'stream: OK'", async () => {
  open = await stub(() => "stream: OK")
  const scanner = makeClamdScanner({ host: "127.0.0.1", port: open.port, chunkBytes: 1024 })
  const data = Buffer.alloc(3000, 7)
  const res = await scanner.scan(Readable.from([data.subarray(0, 1500), data.subarray(1500)]))
  expect(res).toEqual({ clean: true })
  expect(open.commands).toEqual(["zINSTREAM"])
  expect(open.frames.length).toBeGreaterThanOrEqual(3) // 3000 bytes at <= 1024 per frame
  expect(open.frames.every((f) => f.length <= 1024 && f.length > 0)).toBe(true)
  expect(Buffer.concat(open.frames).equals(data)).toBe(true)
  expect(open.sawTerminator()).toBe(true)
})

test("clamd client parses 'stream: Eicar-Signature FOUND' into an infected result with the signature", async () => {
  open = await stub((all) => (all.toString().includes("EICAR") ? "stream: Eicar-Signature FOUND" : "stream: OK"))
  const scanner = makeClamdScanner({ host: "127.0.0.1", port: open.port })
  expect(await scanner.scan(Readable.from([Buffer.from("xx EICAR yy")]))).toEqual({ clean: false, signature: "Eicar-Signature" })
})

test("an empty stream still sends the terminator and gets a verdict", async () => {
  open = await stub(() => "stream: OK")
  const scanner = makeClamdScanner({ host: "127.0.0.1", port: open.port })
  expect(await scanner.scan(Readable.from([]))).toEqual({ clean: true })
  expect(open.frames).toEqual([])
})

test("INSTREAM size limit exceeded is a ScanSizeLimitError, never a clean verdict", async () => {
  open = await stub(() => "stream: OK", { limit: 2048 })
  const scanner = makeClamdScanner({ host: "127.0.0.1", port: open.port, chunkBytes: 1024 })
  const big = Readable.from(Array.from({ length: 64 }, () => Buffer.alloc(1024, 1)))
  await expect(scanner.scan(big)).rejects.toBeInstanceOf(ScanSizeLimitError)
})

test("an unknown or ERROR reply rejects (fail closed)", async () => {
  open = await stub(() => "stream: something odd ERROR")
  const scanner = makeClamdScanner({ host: "127.0.0.1", port: open.port })
  await expect(scanner.scan(Readable.from([Buffer.from("a")]))).rejects.toThrow(/clamd/)
})

test("no reply at all, a closed connection and a refused connection all reject", async () => {
  open = await stub(() => null)
  const scanner = makeClamdScanner({ host: "127.0.0.1", port: open.port })
  await expect(scanner.scan(Readable.from([Buffer.from("a")]))).rejects.toThrow()
  const port = open.port
  await open.close()
  open = undefined
  await expect(makeClamdScanner({ host: "127.0.0.1", port }).scan(Readable.from([Buffer.from("a")]))).rejects.toThrow()
})

test("a source stream error rejects the scan", async () => {
  open = await stub(() => "stream: OK")
  const scanner = makeClamdScanner({ host: "127.0.0.1", port: open.port })
  const bad = new Readable({ read() { this.destroy(new Error("source broke")) } })
  await expect(scanner.scan(bad)).rejects.toThrow(/source broke/)
})
