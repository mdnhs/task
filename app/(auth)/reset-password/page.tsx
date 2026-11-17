import type { Metadata } from "next"

import { ResetPassword } from "@/features/auth"

// The reset token is in the URL: no Referer leak, not indexed. The form strips it from the address bar on mount and sends it only in a POST body.
export const metadata: Metadata = { title: "Reset password · OpsDesk", referrer: "no-referrer", robots: { index: false } }

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams
  return <ResetPassword token={typeof token === "string" ? token : ""} />
}
