"use client"

import { useEffect, useMemo, useRef } from "react"

import { makeAutosaver, type ReportsClient } from "./client"
import type { ShiftReport } from "./types"

export const AUTOSAVE_MS = 800

type Opts = { client: ReportsClient; version: number; onConflict(): void; onError(e: unknown): void }

/**
 * The editor's debounced draft autosave (800 ms), as stable handlers. The autosaver is created after mount and flushed when the page is left (the request outlives the page). Callbacks are read
 * through a ref, so they always see the latest render without re-creating the saver (which would drop its pending edit). `flush` resolves to false when the last save failed.
 */
export function useDraftAutosave(o: Opts) {
  const latest = useRef(o)
  const saver = useRef<ReturnType<typeof makeAutosaver<ShiftReport, ShiftReport>> | null>(null)
  const failing = useRef(false)
  useEffect(() => {
    latest.current = o
  })
  useEffect(() => {
    const a = makeAutosaver<ShiftReport, ShiftReport>({
      delay: AUTOSAVE_MS,
      version: latest.current.version,
      save: (f, v) => latest.current.client.saveDraft({ ...f, version: v }),
      onSaved: () => {
        failing.current = false
      },
      onConflict: () => latest.current.onConflict(),
      onError: (e) => {
        // one report per failure streak, not one per keystroke
        if (failing.current) return
        failing.current = true
        latest.current.onError(e)
      },
    })
    saver.current = a
    return () => {
      void a.flush()
    }
  }, [])
  return useMemo(
    () => ({
      schedule: (f: ShiftReport) => saver.current?.schedule(f),
      async flush(): Promise<boolean> {
        await saver.current?.flush()
        return !failing.current
      },
      version: (): number => saver.current?.version() ?? latest.current.version,
      resume(v: number) {
        failing.current = false
        saver.current?.resume(v)
      },
    }),
    [],
  )
}
