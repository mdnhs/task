import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import { isLateSubmission } from "./lifecycle"
import type { Report, TemplateSection } from "./types"

const read = <T>(f: string): T => JSON.parse(readFileSync(`public/data/reports/${f}`, "utf8"))
const { sections } = read<{ sections: TemplateSection[] }>("template.json")
const { reports } = read<{ reports: Report[] }>("reports.json")

describe("reports seed data", () => {
  it("structured cells match the template columns and are not duplicated", () => {
    const cols = new Map<string, string[] | undefined>(sections.flatMap((s) => s.fields.map((f): [string, string[] | undefined] => [`${s.id}.${f.id}`, f.columns])))
    for (const r of reports)
      for (const [k, f] of Object.entries(r.fields))
        for (const e of f.entries)
          if (e.cells) {
            expect(Object.keys(e.cells).sort(), `${r.id} ${k}`).toEqual([...(cols.get(k) ?? [])].sort())
            const v = Object.values(e.cells)
            expect(new Set(v).size, `${r.id} ${k}`).toBe(v.length)
          }
  })
  it("keeps the original submission time after a resubmission (BR-02)", () => {
    for (const r of reports.filter((x) => x.versions.length > 1)) {
      expect(r.submittedAt).toBe(r.versions[0].at)
      expect(isLateSubmission(r, "17:30")).toBe(false)
    }
  })
})
