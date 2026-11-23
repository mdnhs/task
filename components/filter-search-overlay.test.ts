import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "vitest"
import { FilterSearch } from "./filter-bar"

// A closed FilterSearch bar is flipped edge-on (rotateX 90deg) and aria-hidden. Chrome still hit-tests the zero-height projection, so it swallowed
// real mouse clicks on whichever control sat on that row (the calendar's "Week" button). It must never take pointer events while shut.
const css = readFileSync(join(process.cwd(), "app/styles/kit.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }))

describe("closed search bar overlay", () => {
  test("renders shut and aria-hidden when empty", () => {
    const html = renderToStaticMarkup(createElement(FilterSearch, { value: "", onChange: () => {}, placeholder: "Search" }))
    expect(html).toContain("data-shut")
    expect(html).toMatch(/class="ofs-bar"[^>]*aria-hidden="true"/)
  })
  test("a shut bar has pointer-events none", () => {
    const shut = rules.find((r) => r.sel.split(",").map((s) => s.trim()).includes(".od-filter-search[data-shut] .ofs-bar"))
    expect(shut?.body).toMatch(/pointer-events:\s*none/)
  })
  test("an open bar is not pointer-events none", () => {
    const open = rules.filter((r) => /(^|,)\s*\.ofs-bar\s*(,|$)/.test(r.sel))
    for (const r of open) expect(r.body).not.toMatch(/pointer-events:\s*none/)
  })
})
