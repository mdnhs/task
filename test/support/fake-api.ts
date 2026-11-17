// A tiny recording ApiClient for the T6.4 unit tests: answers by "METHOD /path" and throws the same ApiError the real client would.
import type { ApiClient } from "@/lib/api/client"
import { ApiError } from "@/lib/api/problem"

export type Answer = unknown | { __problem: number; code: string }
export const problem = (status: number, code: string): Answer => ({ __problem: status, code })

export function fakeApi(routes: Record<string, Answer | (() => Answer)>) {
  const calls: { method: string; path: string; query?: unknown; body?: unknown }[] = []
  const handle = (method: string) => async (path: string, o?: { query?: unknown; body?: unknown }) => {
    calls.push({ method, path, query: o?.query, body: o?.body })
    const key = `${method.toUpperCase()} ${path}`
    if (!(key in routes)) throw new ApiError(404, "not_found", "r1")
    const a = typeof routes[key] === "function" ? (routes[key] as () => Answer)() : routes[key]
    if (a && typeof a === "object" && "__problem" in a) throw new ApiError((a as { __problem: number }).__problem, (a as unknown as { code: string }).code, "req-1")
    return a
  }
  const client = { get: handle("get"), post: handle("post"), put: handle("put"), patch: handle("patch"), delete: handle("delete") } as unknown as ApiClient
  return { client, calls, paths: () => calls.map((c) => `${c.method.toUpperCase()} ${c.path}`) }
}
