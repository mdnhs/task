"use client"

import { useState } from "react"
import { toast } from "sonner"

import { Icon } from "@/components/icons"

// Mock reminder: confirms with a toast, then stays disabled so the lead isn't nudged twice from the same view.
export function RemindButton({ label }: { label: string }) {
  const [sent, setSent] = useState(false)
  function remind() {
    setSent(true)
    toast.success("Reminder sent", { description: label.replace(/^Remind /, "") })
  }
  return (
    <button type="button" className="btn btn-primary" onClick={remind} disabled={sent}>
      <Icon name="chat" />
      {sent ? "Reminder sent" : label}
    </button>
  )
}
