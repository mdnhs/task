"use client"

// FR-M1-31 (was FR-REP-12): browser-side PDF, Excel and CSV files. jspdf / jspdf-autotable / exceljs are loaded with dynamic import() only when the
// user clicks export, so they never land in the page bundle. Rows come from export-rows.ts (pure, tested).
import { toCsv, type ExportDoc } from "./export-rows"

export type ExportMeta = {
  /** Tenant name, from the session. */
  company: string
  /** "Tue 20 Oct · Irish time" (tenant today and timezone label). */
  generated: string
  /** Tenant brand colour (#rrggbb); plain when missing or invalid. */
  brand?: string
}

const HEX = /^#[0-9a-f]{6}$/i
const rgb = (hex: string | undefined, fallback: [number, number, number]): [number, number, number] =>
  hex && HEX.test(hex) ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number] : fallback

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportPdf(doc: ExportDoc, meta: ExportMeta) {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")])
  const pdf = new jsPDF({ unit: "pt", format: "a4" })
  const brand = rgb(meta.brand, [60, 60, 60])
  const left = 40
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(10)
  pdf.setTextColor(...brand)
  pdf.text(meta.company, left, 40)
  pdf.setFont("helvetica", "normal")
  pdf.setTextColor(110)
  pdf.text(meta.generated, pdf.internal.pageSize.getWidth() - left, 40, { align: "right" })
  pdf.setFont("helvetica", "bold")
  pdf.setFontSize(18)
  pdf.setTextColor(20)
  pdf.text(doc.title, left, 68)
  pdf.setFont("helvetica", "normal")
  pdf.setFontSize(10)
  pdf.setTextColor(110)
  pdf.text(doc.subtitle, left, 84)
  let y = 100
  if (doc.meta.length) {
    autoTable(pdf, {
      startY: y,
      body: doc.meta,
      theme: "plain",
      styles: { fontSize: 9, cellPadding: 2 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 90, textColor: 90 } },
      margin: { left },
    })
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14
  }
  for (const t of doc.tables) {
    if (t.title) {
      pdf.setFont("helvetica", "bold")
      pdf.setFontSize(11)
      pdf.setTextColor(20)
      if (y > pdf.internal.pageSize.getHeight() - 90) {
        pdf.addPage()
        y = 40
      }
      pdf.text(t.title, left, y + 8)
      y += 14
    }
    autoTable(pdf, {
      startY: y,
      head: [t.head],
      body: t.rows,
      styles: { fontSize: 9, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: brand, textColor: 255 },
      margin: { left, right: left },
    })
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 18
  }
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    pdf.setFontSize(8)
    pdf.setTextColor(140)
    pdf.text(`${meta.company} · page ${i} of ${pages}`, left, pdf.internal.pageSize.getHeight() - 20)
  }
  save(pdf.output("blob"), `${doc.fileBase}.pdf`)
}

export async function exportXlsx(doc: ExportDoc, meta: ExportMeta) {
  const { Workbook } = await import("exceljs")
  const wb = new Workbook()
  wb.creator = meta.company
  const ws = wb.addWorksheet(doc.title.slice(0, 31))
  const [r, g, b] = rgb(meta.brand, [60, 60, 60])
  const argb = "FF" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")
  const widths: number[] = []
  const track = (row: string[]) => row.forEach((c, i) => (widths[i] = Math.min(60, Math.max(widths[i] ?? 10, ...c.split("\n").map((l) => l.length + 2)))))
  ws.addRow([meta.company]).font = { bold: true, color: { argb } }
  ws.addRow([doc.title]).font = { bold: true, size: 14 }
  ws.addRow([`${doc.subtitle} · ${meta.generated}`])
  ws.addRow([])
  for (const m of doc.meta) {
    ws.addRow(m).getCell(1).font = { bold: true }
    track(m)
  }
  for (const t of doc.tables) {
    ws.addRow([])
    if (t.title) ws.addRow([t.title]).font = { bold: true }
    const head = ws.addRow(t.head)
    head.eachCell((c) => {
      c.font = { bold: true, color: { argb: "FFFFFFFF" } }
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb } }
    })
    track(t.head)
    for (const row of t.rows) {
      ws.addRow(row).eachCell((c) => (c.alignment = { wrapText: true, vertical: "top" }))
      track(row)
    }
  }
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w))
  const buf = await wb.xlsx.writeBuffer()
  save(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${doc.fileBase}.xlsx`)
}

/** CSV (UTF-8 with BOM so Excel reads accents, CRLF). No library needed. */
export async function exportCsv(doc: ExportDoc) {
  save(new Blob(["\uFEFF" + toCsv(doc)], { type: "text/csv;charset=utf-8" }), `${doc.fileBase}.csv`)
}
