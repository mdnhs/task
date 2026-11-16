// Shared CSV building and download (D6). RFC 4180: CRLF line ends, a cell with a comma, quote, line break or edge space is
// quoted with its quotes doubled. Text that a spreadsheet would read as a formula (= + - @) gets a leading quote.
// Reports' export (features/reports/export-rows.ts) uses the same cell rules.

/** Quotes a cell when it needs it. */
export const csvEscape = (v: string) => (/[",\n\r]/.test(v) || /^\s|\s$/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** Spreadsheet formula injection: a text cell starting with = + - @ is prefixed with a quote. */
export const csvSafe = (v: string) => (/^[=+\-@]/.test(v) ? `'${v}` : v)

/** One text cell, safe and escaped. */
export const csvCell = (v: string) => csvEscape(csvSafe(v))

export type CsvColumn = { key: string; label: string }

/** A header row from the labels, then one line per row. Numbers are written as they are (a negative number is not a formula). */
export function toCsv(rows: Record<string, string | number>[], columns: CsvColumn[]): string {
  const value = (v: string | number | undefined) => (typeof v === "number" ? String(v) : csvCell(v ?? ""))
  const lines = [columns.map((c) => csvCell(c.label)).join(",")]
  for (const r of rows) lines.push(columns.map((c) => value(r[c.key])).join(","))
  return lines.join("\r\n") + "\r\n"
}
