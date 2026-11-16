import { describe, expect, it } from "vitest"

import { csvCell, toCsv } from "./csv"

describe("toCsv", () => {
  const columns = [{ key: "name", label: "Name" }, { key: "mrr", label: "MRR" }]

  it("writes a header from the labels and one CRLF line per row", () => {
    expect(toCsv([{ name: "Acme", mrr: 49 }], columns)).toBe("Name,MRR\r\nAcme,49\r\n")
  })

  it("escapes commas and quotes", () => {
    const csv = toCsv([{ name: 'Smith, Jones & "Sons"', mrr: 1 }], columns)
    expect(csv.split("\r\n")[1]).toBe('"Smith, Jones & ""Sons""",1')
  })

  it("quotes line breaks and edge spaces, and blanks a missing key", () => {
    expect(toCsv([{ name: "a\nb" }], columns).split("\r\n")[1]).toBe('"a\nb",')
    expect(csvCell(" x")).toBe('" x"')
  })

  it("neutralises spreadsheet formulas", () => {
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)")
    expect(csvCell("-12")).toBe("'-12")
    // Numbers are data, not formulas: a negative number stays as it is.
    expect(toCsv([{ name: "x", mrr: -12 }], columns).split("\r\n")[1]).toBe("x,-12")
  })
})
