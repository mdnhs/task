export * from "@opsdesk/domain/csv"

/** Browser only: saves the text as a UTF-8 CSV (with a BOM so Excel reads accents). */
export function downloadCsv(csv: string, fileName: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = url
  a.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
