"use client"

import { toast } from "sonner"

import { userMessage } from "@/lib/api/problem"
import { reportFilePath } from "../client"
import { openFile } from "../export"

/** Open one clean report attachment: a probe asks the API first (a refusal shows its copy), then a SECOND fresh same-origin path opens in a new tab. No URL is kept. */
export function AttachmentOpen({ reportId, fileId }: { reportId: string; fileId: string }) {
  const nonce = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return (
    <button
      type="button"
      className="sr-open"
      onClick={async () => {
        const r = await openFile((n) => reportFilePath(reportId, fileId, n), { fetch: (...a) => fetch(...a), open: (u) => void window.open(u, "_blank", "noopener,noreferrer"), nonce })
        if (!r.ok) toast.error(userMessage(r.error).text)
      }}
    >
      Open
    </button>
  )
}
