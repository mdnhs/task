import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, test } from "vitest"

// UI-fix regression: the platform settings / team / support forms (.pf-form) were plain blocks, so label, input, hint and the next label touched
// and the Save buttons sat flush against the last field (measured 0px gap). The form must stack its fields with the .od-form rhythm and cap its width.
const css = readFileSync(path.join(__dirname, "../../app/styles/platform.css"), "utf8")
const rule = (selector: string) => {
  const hit = css.split("\n").find((l) => l.startsWith(`${selector}{`))
  if (!hit) throw new Error(`missing CSS rule ${selector}`)
  return hit
}

describe("platform form layout", () => {
  test(".pf-form is a flex column with a 16px gap (same rhythm as .od-form)", () => {
    const r = rule(".pf-form")
    expect(r).toContain("display:flex")
    expect(r).toContain("flex-direction:column")
    expect(r).toContain("gap:16px")
  })
  test("buttons directly in a form keep their own width instead of stretching", () => {
    expect(rule(".pf-form>.btn")).toContain("align-self:flex-start")
  })
  test("settings forms stay at a readable width", () => {
    expect(rule(".pf-set")).toMatch(/max-width:\d+px/)
  })
})
