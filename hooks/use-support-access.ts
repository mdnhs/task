import { useEffect } from "react"

import { createStore } from "@/lib/store"
import { mergeSupport, type SupportAccess } from "@/lib/support-access"

export const supportStore = createStore<SupportAccess[]>()

/**
 * The platform seeds every tenant's rows, tenant settings only its own. Both use one scope and merge by id, so
 * whichever side loads first, the other side's rows are added without dropping local edits.
 */
export function useSupportAccess(rows: SupportAccess[]) {
  const state = supportStore.useStore(rows, "support")
  useEffect(() => {
    supportStore.set((prev) => mergeSupport(prev, rows))
  }, [rows])
  return state
}
