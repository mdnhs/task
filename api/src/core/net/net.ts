import { sendPinned, type PinnedRequest } from "./pinned-request"
import { systemResolver, type Resolver } from "./ssrf-guard"

/** Outbound network seam (injectable in tests): DNS resolution and the pinned HTTPS POST. */
export type Net = {
  resolve: Resolver
  send(r: Omit<PinnedRequest, "request">): Promise<{ status: number }>
}

export function makeNet(): Net {
  return { resolve: systemResolver, send: (r) => sendPinned(r) }
}
