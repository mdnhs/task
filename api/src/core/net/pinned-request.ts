import { request as httpsRequest, type RequestOptions } from "node:https"
import { isIP } from "node:net"
import type { ClientRequest, IncomingMessage } from "node:http"

/**
 * One HTTPS POST to an address that was ALREADY vetted by ssrf-guard (T3.6). This is what defeats DNS rebinding: the socket
 * connects to `address` itself (no second lookup can happen), while TLS SNI / certificate verification and the Host header
 * still use the URL's host name. Redirects are never followed (node's https.request does not), the whole exchange
 * (connect, send, read) is bounded by `timeoutMs`, at most `maxBytes` of the response are read, and only the status code is
 * returned (the body is discarded unseen, so a hostile receiver cannot smuggle data back).
 */
export type PinnedRequest = {
  url: URL
  address: string
  family: number
  headers: Record<string, string>
  body: string
  timeoutMs: number
  maxBytes: number
  /** Test seam: the default is https.request. */
  request?: (o: RequestOptions, cb: (res: IncomingMessage) => void) => ClientRequest
}
export class PinnedRequestError extends Error {
  constructor(public code: "timeout" | "network") {
    super(code)
  }
}

export function sendPinned(o: PinnedRequest): Promise<{ status: number }> {
  const host = o.url.hostname.startsWith("[") ? o.url.hostname.slice(1, -1) : o.url.hostname
  const send = o.request ?? httpsRequest
  return new Promise((resolve, reject) => {
    let settled = false
    let status: number | null = null // set once the status line and headers have arrived
    let req: ClientRequest | undefined
    const done = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      // headers already received: a stalled body is not a failure (the status is what counts; the rest is discarded unseen)
      done(() => (status !== null ? resolve({ status }) : reject(new PinnedRequestError("timeout"))))
      req?.destroy()
    }, o.timeoutMs)
    const opts: RequestOptions = {
      host: o.address,
      family: o.family,
      port: o.url.port === "" ? 443 : Number(o.url.port),
      path: `${o.url.pathname}${o.url.search}`,
      method: "POST",
      headers: { ...o.headers, host: o.url.host, "content-length": String(Buffer.byteLength(o.body)) },
      ...(isIP(host) === 0 ? { servername: host } : {}),
      agent: false,
    }
    try {
      req = send(opts, (res) => {
        status = res.statusCode ?? 0
        const got = status
        let read = 0
        res.on("data", (chunk: Buffer) => {
          read += chunk.length
          if (read >= o.maxBytes) {
            done(() => resolve({ status: got }))
            res.destroy()
          }
        })
        res.on("end", () => done(() => resolve({ status: got })))
        res.on("error", () => done(() => resolve({ status: got }))) // the status line already arrived
        res.on("close", () => done(() => resolve({ status: got })))
      })
    } catch {
      done(() => reject(new PinnedRequestError("network")))
      return
    }
    req.on("error", () => done(() => reject(new PinnedRequestError("network"))))
    req.end(o.body)
  })
}
