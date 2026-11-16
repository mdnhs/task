import { createServer, request as httpRequest, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { assertSafeUrl, isBlockedIp, WebhookUrlError, type Resolver } from "./ssrf-guard"
import { sendPinned } from "./pinned-request"

const PUBLIC = "93.184.216.34"
const pub: Resolver = async () => [{ address: PUBLIC, family: 4 }]
const never: Resolver = async () => {
  throw new Error("DNS must not be consulted for an IP literal")
}
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e instanceof WebhookUrlError ? e.code : `other:${String(e)}`
  }
  return "ok"
}

describe("isBlockedIp", () => {
  test.each([
    "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.1", "100.127.255.255", "127.0.0.1", "127.1.2.3", "169.254.169.254", "172.16.0.1", "172.31.255.255",
    "192.0.0.1", "192.168.1.1", "198.18.0.1", "198.19.255.255", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
    "::", "::1", "fc00::1", "fd12:3456::1", "fe80::1", "febf::1", "ff02::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:10.1.2.3", "::ffff:a9fe:a9fe", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b::c0a8:1", "2002:7f00:1::1", "::127.0.0.1",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true))
  test.each(["93.184.216.34", "8.8.8.8", "100.63.255.255", "100.128.0.1", "172.15.255.255", "172.32.0.1", "192.0.1.1", "198.17.255.255", "198.20.0.1", "223.255.255.255",
    "2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8", "64:ff9b::808:808"])("allows %s", (ip) => expect(isBlockedIp(ip)).toBe(false))
  test("anything that is not an IP is refused (fail closed)", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true)
    expect(isBlockedIp("")).toBe(true)
    expect(isBlockedIp("fe80::1%eth0")).toBe(true)
  })
})

describe("assertSafeUrl", () => {
  test("a public https URL resolves to its (vetted) addresses", async () => {
    const r = await assertSafeUrl("https://hooks.example.com/path?x=1", pub)
    expect(r.addresses).toEqual([{ address: PUBLIC, family: 4 }])
    expect(r.url.hostname).toBe("hooks.example.com")
  })
  test("port rule: default 443 or 1024-65535", async () => {
    expect(await codeOf(assertSafeUrl("https://hooks.example.com:443/x", pub))).toBe("ok")
    expect(await codeOf(assertSafeUrl("https://hooks.example.com:8443/x", pub))).toBe("ok")
    expect(await codeOf(assertSafeUrl("https://hooks.example.com:1024/x", pub))).toBe("ok")
    expect(await codeOf(assertSafeUrl("https://hooks.example.com:65535/x", pub))).toBe("ok")
    for (const p of [80, 22, 25, 1023, 0]) expect(await codeOf(assertSafeUrl(`https://hooks.example.com:${p}/x`, pub))).toBe("invalid_webhook_url")
  })
  test("https only, no userinfo, at most 2048 characters, parseable", async () => {
    expect(await codeOf(assertSafeUrl("http://hooks.example.com/x", pub))).toBe("invalid_webhook_url")
    expect(await codeOf(assertSafeUrl("ftp://hooks.example.com/x", pub))).toBe("invalid_webhook_url")
    expect(await codeOf(assertSafeUrl("https://user:pw@hooks.example.com/x", pub))).toBe("invalid_webhook_url")
    expect(await codeOf(assertSafeUrl("https://user@hooks.example.com/x", pub))).toBe("invalid_webhook_url")
    expect(await codeOf(assertSafeUrl(`https://hooks.example.com/${"a".repeat(2048)}`, pub))).toBe("invalid_webhook_url")
    expect(await codeOf(assertSafeUrl(`https://hooks.example.com/${"a".repeat(2048 - "https://hooks.example.com/".length)}`, pub))).toBe("ok")
    expect(await codeOf(assertSafeUrl("not a url", pub))).toBe("invalid_webhook_url")
    expect(await codeOf(assertSafeUrl("", pub))).toBe("invalid_webhook_url")
  })
  test.each([
    ["IPv4 loopback", "https://127.0.0.1/x"],
    ["10/8", "https://10.1.2.3/x"],
    ["metadata", "https://169.254.169.254/latest/meta-data"],
    ["IPv6 loopback", "https://[::1]/x"],
    ["IPv6 unspecified", "https://[::]/x"],
    ["IPv4-mapped IPv6", "https://[::ffff:127.0.0.1]/x"],
    ["IPv4-mapped IPv6 (hex form)", "https://[::ffff:7f00:1]/x"],
    ["NAT64 of 10.0.0.1", "https://[64:ff9b::a00:1]/x"],
    ["unique-local fd00::", "https://[fd00::1]/x"],
    ["link-local fe80::", "https://[fe80::1]/x"],
    ["decimal IP literal (2130706433 = 127.0.0.1)", "https://2130706433/x"],
    ["octal IP literal (0177.0.0.1)", "https://0177.0.0.1/x"],
    ["hex IP literal (0x7f000001)", "https://0x7f000001/x"],
    ["hex dotted (0x7f.0.0.1)", "https://0x7f.0.0.1/x"],
    ["short form 127.1", "https://127.1/x"],
    ["decimal metadata (2852039166)", "https://2852039166/x"],
    ["0.0.0.0", "https://0.0.0.0/x"],
  ])("IP literal: %s is refused without any DNS lookup", async (_n, url) => {
    expect(await codeOf(assertSafeUrl(url, never))).toBe("unsafe_webhook_url")
  })
  test("a hostname resolving to a private address is refused", async () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "::1", "::ffff:192.168.0.1", "fc00::1"]) {
      const r: Resolver = async () => [{ address, family: address.includes(":") ? 6 : 4 }]
      expect(await codeOf(assertSafeUrl("https://evil.example.com/x", r))).toBe("unsafe_webhook_url")
    }
  })
  test("a hostname resolving to a MIX of public and private addresses is refused (ANY bad address)", async () => {
    const mix: Resolver = async () => [{ address: PUBLIC, family: 4 }, { address: "10.0.0.5", family: 4 }]
    expect(await codeOf(assertSafeUrl("https://mixed.example.com/x", mix))).toBe("unsafe_webhook_url")
    const mix6: Resolver = async () => [{ address: "2606:4700:4700::1111", family: 6 }, { address: "::1", family: 6 }, { address: PUBLIC, family: 4 }]
    expect(await codeOf(assertSafeUrl("https://mixed.example.com/x", mix6))).toBe("unsafe_webhook_url")
  })
  test("no addresses / a DNS failure is refused (fail closed), without leaking the resolver error", async () => {
    expect(await codeOf(assertSafeUrl("https://nx.example.com/x", async () => []))).toBe("unsafe_webhook_url")
    expect(await codeOf(assertSafeUrl("https://nx.example.com/x", async () => { throw new Error("ENOTFOUND secret") }))).toBe("unsafe_webhook_url")
  })
})

describe("resolver timeout", () => {
  const hang: Resolver = () => new Promise(() => {})
  test("a hanging resolver is refused after the timeout (resolve_timeout), not hung", async () => {
    const t0 = Date.now()
    expect(await codeOf(assertSafeUrl("https://slow.example.com/x", hang, 80))).toBe("resolve_timeout")
    expect(Date.now() - t0).toBeLessThan(2000)
  })
})

describe("sendPinned: connects to the vetted IP, never follows redirects, bounded read", () => {
  let server: Server
  let port = 0
  let lastHost: string | undefined
  let hits: string[] = []
  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.url ?? "")
      lastHost = req.headers.host
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" })
        res.end()
      } else if (req.url === "/big") {
        res.writeHead(200)
        res.write(Buffer.alloc(200_000, 97))
        res.end()
      } else if (req.url === "/stall") {
        res.writeHead(200)
        res.write("partial") // headers + a little body, then the body stalls forever
      } else if (req.url === "/slow") {
        // never answers
      } else {
        res.writeHead(204)
        res.end()
      }
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })
  const base = { address: "127.0.0.1", family: 4 as const, headers: { "content-type": "application/json" }, body: "{}", timeoutMs: 10_000, maxBytes: 64 * 1024, request: httpRequest as never }
  test("connects to the pinned address (not whatever the hostname resolves to) and keeps the Host header", async () => {
    const r = await sendPinned({ ...base, url: new URL(`https://hooks.example.invalid:${port}/ok`) })
    expect(r.status).toBe(204)
    expect(lastHost).toBe(`hooks.example.invalid:${port}`)
  })
  test("a 302 is returned as-is: the Location is NOT followed", async () => {
    hits = []
    const r = await sendPinned({ ...base, url: new URL(`https://hooks.example.invalid:${port}/redirect`) })
    expect(r.status).toBe(302)
    expect(hits).toEqual(["/redirect"])
  })
  test("reads at most maxBytes of the body and only the status is returned", async () => {
    const r = await sendPinned({ ...base, url: new URL(`https://hooks.example.invalid:${port}/big`) })
    expect(r).toEqual({ status: 200 })
  })
  test("a body that stalls AFTER the status line is not a timeout: the status is returned", async () => {
    const r = await sendPinned({ ...base, timeoutMs: 200, url: new URL(`https://hooks.example.invalid:${port}/stall`) })
    expect(r).toEqual({ status: 200 })
  })
  test("a server that never answers times out (network error, not a hang)", async () => {
    await expect(sendPinned({ ...base, timeoutMs: 150, url: new URL(`https://hooks.example.invalid:${port}/slow`) })).rejects.toMatchObject({ code: "timeout" })
  })
})
