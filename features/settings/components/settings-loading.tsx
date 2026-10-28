"use client"

import { usePathname } from "next/navigation"

import { isTab } from "../types"
import { SettingsSkeleton } from "./skeletons"
import type { SettingsCounts } from "./skeletons"

// loading.tsx gets no params, so the skeleton reads the target tab from the pathname (falls back to Organisation).
export function SettingsLoading({ counts, canWrite, billing }: { counts: SettingsCounts; canWrite: boolean; billing?: React.ReactNode }) {
  const last = usePathname().split("/").filter(Boolean).pop() ?? ""
  return <SettingsSkeleton tab={isTab(last) ? last : "organisation"} counts={counts} canWrite={canWrite} billing={billing} />
}
