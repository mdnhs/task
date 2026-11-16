import net from "node:net"
import type { Readable } from "node:stream"
import type { Env } from "../../env"
import type { MalwareScanner, ScanResult } from "./scanner"

export class ScanSizeLimitError extends Error {
  constructor() {
    super("clamd: INSTREAM size limit exceeded")
    this.name = "ScanSizeLimitError"
  }
}

export type ClamdConfig = { host: string; port: number; timeoutMs?: number; chunkBytes?: number }

/** clamd's StreamMaxLength is typically 25 MB+; frames themselves may be any size up to it, 64 KiB keeps memory flat. */
const DEFAULT_CHUNK = 64 * 1024

/**
 * clamd INSTREAM client. Protocol (clamd(8)): send `zINSTREAM\0`, then repeated frames of a 4-byte big-endian length and
 * that many bytes, then a zero length. clamd replies one NUL-terminated line: `stream: OK`, `stream: <signature> FOUND`,
 * or `... ERROR` (for example `INSTREAM size limit exceeded. ERROR`). Anything that is not exactly OK or FOUND rejects,
 * so a broken scanner can never produce a clean verdict. The source is read chunk by chunk with backpressure.
 */
export function makeClamdScanner(cfg: ClamdConfig): MalwareScanner {
  const timeoutMs = cfg.timeoutMs ?? 120_000
  const chunkBytes = cfg.chunkBytes ?? DEFAULT_CHUNK
  return {
    scan(stream: Readable): Promise<ScanResult> {
      return new Promise<ScanResult>((resolve, reject) => {
        const sock = net.createConnection({ host: cfg.host, port: cfg.port })
        sock.setTimeout(timeoutMs)
        const reply: Buffer[] = []
        let done = false
        let writeError: Error | undefined
        const finish = (fn: () => void) => {
          if (done) return
          done = true
          stream.destroy()
          sock.destroy()
          fn()
        }
        sock.on("data", (d) => reply.push(d))
        sock.on("timeout", () => finish(() => reject(new Error("clamd: timeout"))))
        sock.on("error", (err) => {
          writeError = err
          // clamd may answer and hang up before we finish writing (size limit): let "close" parse what arrived
          if (reply.length === 0) finish(() => reject(new Error(`clamd: ${(err as NodeJS.ErrnoException).code ?? err.message}`)))
        })
        sock.on("close", () => {
          if (done) return
          const text = Buffer.concat(reply).toString("utf8").replace(/\0+$/, "").trim()
          let result: ScanResult
          try {
            result = parseReply(text, writeError)
          } catch (e) {
            return finish(() => reject(e))
          }
          finish(() => resolve(result))
        })
        sock.on("connect", () => {
          void send(sock, stream, chunkBytes).catch((err: Error) => finish(() => reject(err)))
        })
      })
    },
  }
}

function parseReply(text: string, writeError?: Error): ScanResult {
  if (text === "") throw new Error(`clamd: no reply${writeError ? ` (${writeError.message})` : ""}`)
  if (/size limit exceeded/i.test(text)) throw new ScanSizeLimitError()
  if (text === "stream: OK") return { clean: true }
  const found = /^stream: (.{1,200}) FOUND$/.exec(text)
  if (found) return { clean: false, signature: found[1] }
  throw new Error("clamd: unexpected reply")
}

/** Write errors are not fatal here: clamd may already have answered and closed, so "close" decides the outcome. */
async function send(sock: net.Socket, source: Readable, chunkBytes: number): Promise<void> {
  let broken = false
  const write = (b: Buffer) =>
    new Promise<void>((res) => {
      if (sock.destroyed || broken) return res()
      sock.write(b, (err) => {
        if (err) broken = true
        res()
      })
    })
  await write(Buffer.from("zINSTREAM\0"))
  for await (const raw of source) {
    if (broken || sock.destroyed) break
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array)
    for (let off = 0; off < buf.length; off += chunkBytes) {
      const part = buf.subarray(off, Math.min(off + chunkBytes, buf.length))
      const head = Buffer.alloc(4)
      head.writeUInt32BE(part.length, 0)
      await write(Buffer.concat([head, part]))
    }
  }
  await write(Buffer.alloc(4)) // zero-length terminator
}

export function clamdFromEnv(env: Env): MalwareScanner | null {
  return env.CLAMD_HOST ? makeClamdScanner({ host: env.CLAMD_HOST, port: env.CLAMD_PORT }) : null
}
