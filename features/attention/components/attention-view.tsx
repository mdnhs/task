"use client"

import { PageHead } from "@/components/page-head"
import type { AttentionItem, OutstandingItem } from "../types"
import { AttentionList } from "./attention-list"
import { OutstandingList } from "./outstanding-list"

export function AttentionView({
  items,
  outstanding,
  today,
  tz,
  tzLabel,
  canWrite,
  actor,
  scopeKey,
}: {
  items: AttentionItem[]
  outstanding: OutstandingItem[]
  today: string
  /** IANA timezone from the org settings; stamps decisions. */
  tz: string
  tzLabel: string
  canWrite: boolean
  actor: string
  scopeKey: string
}) {
  return (
    <>
      <PageHead title="Manager Attention" subtitle="Decisions waiting for you and items carried forward from earlier days" />
      <AttentionList items={items} today={today} tz={tz} tzLabel={tzLabel} canDecide={canWrite} actor={actor} scopeKey={scopeKey} />
      <OutstandingList outstanding={outstanding} today={today} tzLabel={tzLabel} canEdit={canWrite} scopeKey={scopeKey} />
    </>
  )
}
