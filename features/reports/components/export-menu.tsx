"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { apiBrowser } from "@/lib/api/browser"
import { userMessage } from "@/lib/api/problem"
import { EXPORT_COPY, makeExportClient, openExport, type ExportOutcome, type ExportRequest } from "../export"
import type { ExportFormat } from "../export-rows"

const LABEL: Record<ExportFormat, string> = { pdf: "PDF", xlsx: "Excel", csv: "CSV" }
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Export menu (FR-M1-31, I27): PDF, Excel or CSV, made by a SERVER job. The menu asks for it, polls (1 s, then 2 s) while the tab is visible and the menu is mounted, and opens the finished
 * file through the same-origin download path with a fresh nonce; the URL is never kept. If the tab is hidden the polling stops and resumes when it is visible again. The trigger is disabled
 * with a spinner while a file is being made. The PDF is Latin-1 only: a one-line note recommends CSV or Excel for other scripts.
 */
export function ExportMenu({ label, request, className = "" }: { label: string; request: Omit<ExportRequest, "format">; className?: string }) {
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const pending = useRef<{ id: string; format: ExportFormat } | null>(null)
  const abort = useRef<AbortController | null>(null)
  const client = useMemo(() => makeExportClient(apiBrowser, { wait, hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden" }), [])

  const finish = async (o: ExportOutcome, format: ExportFormat) => {
    if (!alive.current) return
    switch (o.kind) {
      case "done": {
        pending.current = null
        const r = await openExport(o.id, { fetch: (...a) => fetch(...a), open: (u) => void window.open(u, "_blank", "noopener"), nonce: () => `${Date.now()}-${Math.random().toString(36).slice(2)}` })
        if (r.ok) toast.success(`${LABEL[format]} ready`, { description: o.status.rowCount === null ? undefined : `${o.status.rowCount} ${o.status.rowCount === 1 ? "report" : "reports"}` })
        else toast.error(userMessage(r.error).text)
        setBusy(false)
        break
      }
      case "failed":
        pending.current = null
        toast.error(EXPORT_COPY.failed(o.code))
        setBusy(false)
        break
      case "expired":
        pending.current = null
        toast.error(EXPORT_COPY.expired)
        setBusy(false)
        break
      case "timeout":
        toast(EXPORT_COPY.timeout)
        setBusy(false)
        break
      case "paused":
        // the tab is hidden or the page was left: the export keeps running on the server; the visibility handler resumes it
        pending.current = { id: o.id, format }
        break
    }
  }

  const run = async (format: ExportFormat) => {
    if (busy) return
    setBusy(true)
    abort.current = new AbortController()
    try {
      await finish(await client.run({ ...request, format }, { signal: abort.current.signal }), format)
    } catch (e) {
      toast.error(userMessage(e).text)
      if (alive.current) setBusy(false)
    }
  }

  useEffect(() => {
    alive.current = true
    const onVisible = () => {
      const p = pending.current
      if (!p || document.visibilityState !== "visible") return
      pending.current = null
      abort.current = new AbortController()
      void client.poll(p.id, { signal: abort.current.signal }).then((o) => finish(o, p.format)).catch((e) => {
        toast.error(userMessage(e).text)
        setBusy(false)
      })
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      // the user left: polling stops (the export keeps running on the server and expires by itself)
      alive.current = false
      abort.current?.abort()
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [client])

  return (
    <DropdownMenu>
      <DropdownMenuTrigger disabled={busy} aria-busy={busy || undefined} render={<button type="button" className={`btn btn-outline rep-export ${className}`.trim()} />}>
        <span className="rep-export-label">Export</span>
        {busy && <span className="od-spin rep-export-spin" aria-hidden="true" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="od-menu rep-menu">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
          {(["pdf", "xlsx", "csv"] as const).map((f) => (
            <DropdownMenuItem key={f} onClick={() => void run(f)}>{LABEL[f]}</DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <p className="rep-menu-note">{EXPORT_COPY.pdfNote}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
