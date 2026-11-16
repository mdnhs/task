import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "vitest"

test("domain has no I/O, framework or app-alias imports", () => {
  const offenders = readdirSync(__dirname).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => /from "(node:|next\/|react|@\/)/.test(readFileSync(join(__dirname, f), "utf8")))
  expect(offenders).toEqual([])
})

test("domain only imports siblings", () => {
  const offenders = readdirSync(__dirname).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .filter((f) => /from "\.\.\//.test(readFileSync(join(__dirname, f), "utf8")))
  expect(offenders).toEqual([])
})

test("domain has moved its rules", () => {
  expect(readdirSync(__dirname)).toContain("permissions.ts")
})
