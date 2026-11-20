import type { Metadata } from "next"

import { AcceptInvite, getInviteViewer } from "@/features/auth"

// The token is in the URL, so the page must not leak it through Referer. Rendering it calls nothing that uses the invitation (a mail scanner opening the
// link must not consume it): only the Accept click does. The page only asks who is signed in, to offer Accept or sign-in / sign-up.
export const metadata: Metadata = { title: "Join your team · OpsDesk", referrer: "no-referrer", robots: { index: false } }

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams
  return <AcceptInvite token={typeof token === "string" ? token : ""} email={await getInviteViewer()} />
}
