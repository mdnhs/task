import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"

// B8 Task 18: the k6 files are plain ES modules run by k6, not by node: here they are only syntax-checked (`node --check`), the thresholds file parses and carries the roster targets, and the README says the same numbers.
const LOAD = new URL("../../load/", import.meta.url)
const read = (p: string) => readFileSync(new URL(p, LOAD), "utf8")

describe("k6 load files (B8 T18)", () => {
  test.each(["k6/lib.js", "k6/scenarios.js", "k6/smoke.js"])("%s passes node --check as an ES module", (file) => {
    const r = spawnSync(process.execPath, ["--check", "--input-type=module"], { input: read(file), encoding: "utf8" })
    expect(r.stderr, file).toBe("")
    expect(r.status, file).toBe(0)
  })

  test("thresholds.json parses; the roster targets are the documented ones (week payload p95 < 400 ms, publish p95 < 800 ms at 250 users and 40 locations) and the older ones are kept", () => {
    const t = JSON.parse(read("k6/thresholds.json")) as Record<string, string[]>
    expect(t["http_req_duration{name:roster_week}"]).toEqual(["p(95)<400"])
    expect(t["http_req_duration{name:roster_publish}"]).toEqual(["p(95)<800"])
    expect(t["http_req_duration{kind:read}"]).toEqual(["p(95)<500"])
    expect(t["http_req_duration{kind:write}"]).toEqual(["p(95)<800"])
    expect(t["http_req_duration{name:report_submit}"]).toEqual(["p(95)<2000"])
    const readme = read("README.md")
    expect(readme).toMatch(/roster_week.*p\(95\) < 400 ms/)
    expect(readme).toMatch(/roster_publish.*p\(95\) < 800 ms/)
    expect(readme).toMatch(/250 users.*40 (locations|sites)/is)
  })

  test("the scenario carries the four roster steps and tags each by name, and the smoke profile reuses the same mix", () => {
    const s = read("k6/scenarios.js")
    for (const name of ["roster_mine", "roster_week", "roster_check", "roster_publish"]) expect(s, name).toContain(`"${name}"`)
    expect(s).toContain('["roster", 10]')
    expect(read("k6/smoke.js")).toContain('from "./scenarios.js"')
  })
})
