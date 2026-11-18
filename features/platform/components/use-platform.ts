"use client"

import { useMemo } from "react"
import { toast } from "sonner"

import { useApiAction } from "@/hooks/use-api-action"
import { apiBrowser } from "@/lib/api/browser"
import { PlatformInputError, makePlatformClient } from "../client"

/** The console's writes from the browser: one request per action key, the mapped error copy and a refresh of the server record after every answer (B6 I10). */
export function usePlatform() {
  const run = useApiAction()
  const client = useMemo(() => makePlatformClient(apiBrowser), [])
  /** `ok` is the success toast. An input the API would refuse is shown without a request. Resolves true when the write went through. */
  async function act<T>(key: string, request: () => Promise<T>, ok: string): Promise<{ ok: true; value: T } | { ok: false }> {
    const r = await run(key, async () => {
      try {
        return await request()
      } catch (e) {
        if (e instanceof PlatformInputError) {
          toast.error(e.message)
          return Promise.reject(Object.assign(new Error("input"), { handledInput: true }))
        }
        throw e
      }
    }, { handled: (e) => !!(e as { handledInput?: boolean })?.handledInput })
    if (!r.ok) return { ok: false }
    toast.success(ok)
    return { ok: true, value: r.value }
  }
  return { client, act }
}
