import type { Metadata } from "next"

import { VerifyEmail } from "@/features/auth"

// The token is in the URL, so the page must not leak it through Referer. Rendering it calls NOTHING (a mail scanner opening the link must not consume
// the token): only the Verify button's click does.
export const metadata: Metadata = { title: "Verify your email · OpsDesk", referrer: "no-referrer", robots: { index: false } }

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams
  return <VerifyEmail token={typeof token === "string" ? token : ""} />
}
