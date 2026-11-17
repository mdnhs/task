"use client"

import { useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { makeActionRunner } from "@/lib/api/action"

/**
 * The page's write runner (B6 ruling I10): one request per action key, the mapped error copy with a "Ref <requestId>" line, and `router.refresh()` after every
 * answer so the server record is what stays on screen (a refused optimistic change reverts by construction). The core is lib/api/action.ts.
 */
export function useApiAction() {
  const router = useRouter()
  return useMemo(
    () => makeActionRunner({ notify: (m) => toast.error(m.text, m.ref ? { description: `Ref ${m.ref}` } : undefined), refresh: () => router.refresh() }),
    [router],
  )
}
