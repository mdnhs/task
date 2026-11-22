import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { Logo } from "@/features/shell/components/sidebar-parts"

// The tenant portal sidebar brand block shows the workspace's own name; the platform console keeps the product name.
const html = (props: Parameters<typeof Logo>[0]) => renderToStaticMarkup(createElement(Logo, props))

describe("sidebar brand block", () => {
  it("shows the organization name with the mark, a full-name tooltip and an org class for truncation", () => {
    const out = html({ name: "Northgate Facilities" })
    expect(out).toContain("Northgate Facilities")
    expect(out).toContain('title="Northgate Facilities"')
    expect(out).toContain("logo-org")
    expect(out).toContain("logo-mark")
    expect(out).not.toContain("OpsDesk")
  })

  it("falls back to the product name only when no name exists", () => {
    expect(html({ name: "" })).toContain(">OpsDesk<")
    expect(html({ name: "   " })).toContain(">OpsDesk<")
    expect(html({})).toContain(">OpsDesk<")
  })

  it("escapes the name", () => {
    const out = html({ name: '<img src=x onerror="a">' })
    expect(out).not.toContain("<img")
  })

  it("the platform console keeps its own branding", () => {
    const out = html({ href: "/platform", name: "Northgate Facilities" })
    expect(out).toContain(">OpsDesk<")
    expect(out).not.toContain("Northgate")
  })

  it("the loading skeleton keeps the mark and replaces the text with a block", () => {
    const out = html({ skeleton: true })
    expect(out).toContain("logo-mark")
    expect(out).toContain('class="sk')
    expect(out).not.toContain("OpsDesk")
  })
})
