"use client"

import { usePathname } from "next/navigation"

import { isTab } from "../types"
import { AccountSkeleton } from "./skeletons"
import type { AccountCounts } from "./skeletons"

// loading.tsx gets no params, so the skeleton reads the target tab from the pathname (falls back to Profile).
export function AccountLoading({ counts }: { counts: AccountCounts }) {
  const last = usePathname().split("/").filter(Boolean).pop() ?? ""
  return <AccountSkeleton tab={isTab(last) ? last : "profile"} counts={counts} />
}
