"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Icon } from "@/components/icons"
import { copyText } from "@/lib/clipboard"
import { ACTION } from "@/lib/motion"

/**
 * A small copy button for an ID (tenant id, invoice number, request id, audit entry). Copies with a fallback
 * (lib/clipboard.ts), confirms with a drawn tick and a toast, and says what failed when both ways are blocked.
 * `what` names the value for screen readers: "tenant ID" → "Copy tenant ID t1".
 */
export function CopyId({ value, what = "ID", className }: { value: string; what?: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), ACTION.done * 1000 * 2)
    return () => clearTimeout(t)
  }, [copied])

  async function copy() {
    if (await copyText(value)) {
      setCopied(true)
      toast.success(`Copied ${value}`)
    } else toast.error("Could not copy", { description: `Select ${value} and copy it instead.` })
  }

  return (
    <button type="button" className={className ? `od-copy ${className}` : "od-copy"} aria-label={`Copy ${what} ${value}`} title={`Copy ${what}`} onClick={copy}>
      {copied ? (
        <span key="ok" className="od-act-ico od-copy-ok"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} /></svg></span>
      ) : (
        <Icon name="copy" />
      )}
    </button>
  )
}
