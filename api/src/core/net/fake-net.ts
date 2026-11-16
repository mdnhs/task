import type { Net } from "./net"
import type { PinnedRequest } from "./pinned-request"

export type SentRequest = Omit<PinnedRequest, "request">
/** In-memory Net for tests: scripted DNS (default: every host resolves to a public address) and scripted replies (default 200). */
export type FakeNet = Net & {
  dns: Map<string, string[]>
  sent: SentRequest[]
  resolves: string[]
  /** Return a status, or an Error to simulate a network failure (a thrown error is a network failure too). */
  reply: (r: SentRequest) => number | Error
}

export function fakeNet(): FakeNet {
  const f: FakeNet = {
    dns: new Map(),
    sent: [],
    resolves: [],
    reply: () => 200,
    resolve: async (host) => {
      f.resolves.push(host)
      return (f.dns.get(host) ?? ["93.184.216.34"]).map((address) => ({ address, family: address.includes(":") ? 6 : 4 }))
    },
    send: async (r) => {
      f.sent.push(r)
      const out = f.reply(r)
      if (out instanceof Error) throw out
      return { status: out }
    },
  }
  return f
}
