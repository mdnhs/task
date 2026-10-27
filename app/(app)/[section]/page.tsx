import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { ComingSoon, findNavItem, getNavigation } from "@/features/shell"

// Placeholder for every sidebar section that isn't built yet.
// When a feature is built, add a static route (e.g. app/(app)/tasks/page.tsx); static routes win over this one.
export const dynamicParams = false

export async function generateStaticParams() {
  const nav = await getNavigation()
  return [...nav.menu, ...nav.general].filter((n) => n.href !== "/").map((n) => ({ section: n.href.slice(1) }))
}

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }): Promise<Metadata> {
  const item = findNavItem(await getNavigation(), (await params).section)
  return { title: item ? `${item.label} · OpsDesk` : "OpsDesk" }
}

export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const item = findNavItem(await getNavigation(), (await params).section)
  if (!item) notFound()
  return <ComingSoon item={item} />
}
