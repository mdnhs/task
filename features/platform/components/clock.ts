"use client"

import { useSyncExternalStore } from "react"

import { nowInTz } from "@/lib/dates"
import { isoSeconds } from "../logic"

const subscribe = (cb: () => void) => {
  const id = setInterval(cb, 1000)
  return () => clearInterval(id)
}

/** The org's current wall-clock time in seconds (see isoSeconds), ticking each second. null on the server and the first client render. */
export function useOrgNow(today: string, tz: string): number | null {
  const tick = useSyncExternalStore(subscribe, () => Math.floor(Date.now() / 1000), () => 0)
  return tick ? isoSeconds(nowInTz(today, tz, new Date(tick * 1000))) : null
}
