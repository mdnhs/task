"use client"

import { useState } from "react"
import { toast } from "sonner"

import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { ExportMeta } from "../export"
import type { ExportDoc } from "../export-rows"

export type ExportGroup = { key: string; label: string; doc: ExportDoc | null }

// Export menu (FR-REP-12): PDF or Excel for each group. The export libraries load on click, never with the page.
// The trigger is disabled with a spinner while a file is being made; a toast confirms the download.
export function ExportMenu({ groups, meta, className = "" }: { groups: ExportGroup[]; meta: ExportMeta; className?: string }) {
  const [busy, setBusy] = useState(false)
  const usable = groups.filter((g) => g.doc)

  const run = async (g: ExportGroup, kind: "pdf" | "xlsx") => {
    if (!g.doc || busy) return
    setBusy(true)
    try {
      const mod = await import("../export")
      await (kind === "pdf" ? mod.exportPdf : mod.exportXlsx)(g.doc, meta)
      toast.success(`${kind === "pdf" ? "PDF" : "Excel"} exported`, { description: `${g.doc.fileBase}.${kind}` })
    } catch {
      toast.error("Could not create the file. Try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={busy || usable.length === 0}
        aria-busy={busy || undefined}
        render={<button type="button" className={`btn btn-outline rep-export ${className}`.trim()} />}
      >
        <span className="rep-export-label">Export</span>
        {busy && <span className="od-spin rep-export-spin" aria-hidden="true" />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="od-menu rep-menu">
        {usable.map((g) => (
          <DropdownMenuGroup key={g.key}>
            {usable.length > 1 && <DropdownMenuLabel>{g.label}</DropdownMenuLabel>}
            <DropdownMenuItem onClick={() => void run(g, "pdf")}>{usable.length > 1 ? "PDF" : `${g.label} as PDF`}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => void run(g, "xlsx")}>{usable.length > 1 ? "Excel" : `${g.label} as Excel`}</DropdownMenuItem>
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
