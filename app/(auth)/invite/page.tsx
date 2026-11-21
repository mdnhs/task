import type { Metadata } from "next"

import { AcceptInvite, getInviteData } from "@/features/auth"

// The token is in the URL, so the page must not leak it through Referer. Rendering only READS what the link is for (the API's preview) and who is signed in: it
// never uses the invitation up (a mail scanner opening the link must not consume it). Only the button does.
export const metadata: Metadata = { title: "Join your team · OpsDesk", referrer: "no-referrer", robots: { index: false } }

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams
  const t = typeof token === "string" ? token : ""
  return <AcceptInvite token={t} data={await getInviteData(t)} />
}
