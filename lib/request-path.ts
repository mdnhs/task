import { headers } from "next/headers"

// loading.tsx receives no route params, so proxy.ts forwards the pathname in `x-od-path`.
// `lastSegment("/tasks/")` → the segment after "/tasks/" (decoded), or undefined when the path is not under it.
export async function lastSegment(prefix: string): Promise<string | undefined> {
  const path = (await headers()).get("x-od-path") ?? ""
  if (!path.startsWith(prefix)) return undefined
  const rest = path.slice(prefix.length).split("/")[0]
  if (!rest) return undefined
  try {
    return decodeURIComponent(rest)
  } catch {
    return rest
  }
}

/** The request's pathname as forwarded by proxy.ts ("" when unknown). */
export async function requestPath(): Promise<string> {
  return (await headers()).get("x-od-path") ?? ""
}

/** One search param of the request, as forwarded by proxy.ts (`x-od-search`); null when absent. */
export async function requestParam(name: string): Promise<string | null> {
  return new URLSearchParams((await headers()).get("x-od-search") ?? "").get(name)
}
