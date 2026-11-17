import { describe, expect, it } from "vitest"
import {
  CSV_BOM, EXPORT_LIMITS, EXPORT_MIME, exportCsvCell, exportFileName, exportText, inboxRowCells, itemRowCells, rangeDocHead, reportDocTables, tableToCsv, type ExportReport,
} from "./report-export"

const report = (o: Partial<ExportReport> = {}): ExportReport => ({
  date: "2026-10-24", shiftName: "Night", team: "Night team", person: "Ada Lovelace", state: "late", start: "2026-10-24T22:00", end: "2026-10-25T06:00", due: "2026-10-25T07:00",
  submittedAt: "2026-10-25T07:30", hasReport: true, summary: "Quiet night", blockers: "", unplanned: [{ text: "Helped next door", minutes: 20 }], extra: [["Handover / Keys", "Returned"]],
  items: [{ ref: "TSK-12", title: "Check fire exits", status: "done", minutes: 30, note: "ok" }, { ref: "TSK-13", title: "Lock up", status: "blocked", minutes: 0, note: "" }], ...o,
})

describe("CSV formula injection (privacy: an export is opened in a spreadsheet)", () => {
  it("summary '=HYPERLINK(\"http://x\")', '+1', '-2', '@SUM(A1)', tab and CR starts all come out prefixed with ' and quoted; BOM present; RFC 4180 quoting for commas, quotes and newlines", () => {
    expect(exportCsvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`)
    expect(exportCsvCell("+1")).toBe(`"'+1"`)
    expect(exportCsvCell("-2")).toBe(`"'-2"`)
    expect(exportCsvCell("@SUM(A1)")).toBe(`"'@SUM(A1)"`)
    expect(exportCsvCell("\tx")).toBe(`"'\tx"`)
    expect(exportCsvCell("\rx")).toBe(`"'\rx"`)
    expect(exportCsvCell("a,b")).toBe('"a,b"')
    expect(exportCsvCell('say "hi"')).toBe('"say ""hi"""')
    expect(exportCsvCell("two\nlines")).toBe('"two\nlines"')
    expect(exportCsvCell("plain text")).toBe("plain text")
    expect(exportCsvCell("1-2")).toBe("1-2") // only a LEADING character is dangerous
    expect(exportCsvCell("")).toBe("")
    const csv = tableToCsv({ head: ["Summary"], rows: [['=HYPERLINK("http://x")'], ["+1"], ["-2"], ["@SUM(A1)"], ["\tx"], ["\rx"], ["a,b"]] })
    expect(csv.startsWith(CSV_BOM)).toBe(true)
    expect(CSV_BOM).toBe("﻿")
    expect(csv).toBe(CSV_BOM + ["Summary", `"'=HYPERLINK(""http://x"")"`, `"'+1"`, `"'-2"`, `"'@SUM(A1)"`, `"'\tx"`, `"'\rx"`, '"a,b"'].join("\r\n") + "\r\n")
  })

  it("the text rule is one function for every format: a leading = + - @ tab CR gets a quote; control characters that break XML or a terminal are dropped", () => {
    expect(["=1+1", "+1", "-2", "@x", "\tx", "\rx"].map(exportText)).toEqual(["'=1+1", "'+1", "'-2", "'@x", "'\tx", "'\rx"])
    expect(exportText("a\u0000b\u0007c\u001bd")).toBe("abcd")
    expect(exportText("keep\nnewline\tand tab")).toBe("keep\nnewline\tand tab")
    expect(exportText("<script>alert(1)</script>")).toBe("<script>alert(1)</script>") // inert text in CSV, XLSX (a string cell) and PDF (drawn text); never markup
  })
})

describe("CSV guard: a formula lead hidden behind whitespace or a line break (T5.5 review M2)", () => {
  it("a cell that starts with spaces, a newline, NBSP or a zero-width character and then = + - @ is neutralised and quoted in every sink's text rule", () => {
    for (const lead of [" ", "  ", "\n", "\r\n", " \n ", "\u00a0", "\u200b", "\ufeff", "\u2028"]) {
      for (const f of ["=", "+", "-", "@"]) {
        const cell = `${lead}${f}1+1`
        expect(exportText(cell), JSON.stringify(cell)).toBe(`'${cell}`)
        expect(exportCsvCell(cell), JSON.stringify(cell)).toBe(`"'${cell.replace(/"/g, '""')}"`)
      }
    }
    expect(exportCsvCell(" =1+1")).toBe(`"' =1+1"`)
    expect(exportCsvCell("\n=1+1")).toBe(`"'\n=1+1"`)
  })

  it("ordinary text, dates, numbers and inner operators are unchanged", () => {
    for (const ok of ["2026-10-25", "10:30", "Check fire exits", " leading space only", "a = b", "x+y", "12", "line one\nline two", "Dr -5 stock", "2026-10-25T07:00"]) expect(exportText(ok), ok).toBe(ok)
    expect(exportCsvCell("2026-10-25")).toBe("2026-10-25")
    expect(exportCsvCell("line one\nline two")).toBe('"line one\nline two"')
  })
})

describe("file names hold no personal data", () => {
  it("range 'shift-reports-<from>-<to>-<scope>.<ext>', single 'shift-report-<8 hex of the report id>.<ext>'", () => {
    expect(exportFileName({ kind: "range", from: "2026-10-19", to: "2026-10-25", scope: "team" }, "csv")).toBe("shift-reports-2026-10-19-2026-10-25-team.csv")
    expect(exportFileName({ kind: "range", from: "2026-10-19", to: "2026-10-25", scope: "all" }, "xlsx")).toBe("shift-reports-2026-10-19-2026-10-25-all.xlsx")
    expect(exportFileName({ kind: "single", reportId: "1a2b3c4d-8d3a-4b7e-9c41-2a5b7e90d3f8" }, "pdf")).toBe("shift-report-1a2b3c4d.pdf")
    expect(exportFileName({ kind: "single", reportId: "1A2B3C4D-8d3a-4b7e-9c41-2a5b7e90d3f8" }, "pdf")).toBe("shift-report-1a2b3c4d.pdf")
    expect(EXPORT_MIME.csv).toMatch(/^text\/csv/)
  })
  it("the limits are the ruling's", () => {
    expect(EXPORT_LIMITS).toMatchObject({ rangeDays: 92, reports: 5000, rows: 50000, pdfReports: 500, page: 200, active: 3, ttlDays: 7 })
    expect(EXPORT_LIMITS.maxBytes).toBe(25 * 1024 * 1024)
  })
})

describe("row building (shared by the PDF, Excel and CSV encoders)", () => {
  it("an inbox row: date, shift with its window, team, person, state label, due, submitted (late marked), counts and time; a virtual row has blanks", () => {
    expect(rangeDocHead.reports).toEqual(["Date", "Shift", "Team", "Person", "Status", "Due", "Submitted", "Tasks", "Done", "Time", "Summary", "Blockers"])
    expect(inboxRowCells(report())).toEqual(["2026-10-24", "Night 22:00–06:00 +1", "Night team", "Ada Lovelace", "Late", "2026-10-25 07:00", "2026-10-25 07:30 (late)", "2", "1", "50m", "Quiet night", ""])
    expect(inboxRowCells(report({ state: "missing", hasReport: false, submittedAt: null, items: [], unplanned: [], summary: "", blockers: "" }))).toEqual(["2026-10-24", "Night 22:00–06:00 +1", "Night team", "Ada Lovelace", "Missing", "2026-10-25 07:00", "Not submitted", "", "", "", "", ""])
    expect(itemRowCells(report())).toEqual([["2026-10-24", "Ada Lovelace", "TSK-12", "Check fire exits", "Done", "30", "ok"], ["2026-10-24", "Ada Lovelace", "TSK-13", "Lock up", "Blocked", "0", ""]])
  })
  it("one report: details, tasks, unplanned and notes (the template's extra answers by label)", () => {
    const t = reportDocTables(report())
    expect(t.map((x) => x.title)).toEqual(["Tasks in the shift", "Unplanned work", "Notes"])
    expect(t[2].rows).toEqual([["Summary", "Quiet night"], ["Blockers", ""], ["Handover / Keys", "Returned"]])
  })
})
