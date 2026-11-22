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

  it("an uploaded logo replaces the check mark inside the same 38px mark box, followed by the organization name", () => {
    const out = html({ name: "Northgate Facilities", logo: { version: "9f86d081884c7d65", mime: "image/png", width: 240, height: 64, sizeBytes: 8123 } })
    expect(out).toContain('class="logo-mark has-logo"')
    expect(out).toContain('src="/v1/branding/logo?v=9f86d081884c7d65"')
    expect(out).toContain('alt=""') // decorative: the name sits next to it and the link has its own label
    expect(out).toContain("Northgate Facilities")
    expect(out).not.toContain("<svg") // no check mark
    expect(out.indexOf("<img")).toBeLessThan(out.indexOf(">Northgate Facilities<")) // the mark comes first, then the name
  })

  it("without a logo it is the check mark, byte for byte the old markup", () => {
    const out = html({ name: "Northgate Facilities", logo: null })
    expect(out).toContain('class="logo-mark"')
    expect(out).toContain("<svg")
    expect(out).not.toContain("<img")
  })

  it("the console never shows a company logo", () => {
    const out = html({ href: "/platform", name: "Northgate Facilities", logo: { version: "v1", mime: "image/png", width: 40, height: 40, sizeBytes: 5 } })
    expect(out).not.toContain("<img")
    expect(out).toContain("<svg")
  })

  it("the loading skeleton keeps the mark and replaces the text with a block", () => {
    const out = html({ skeleton: true })
    expect(out).toContain("logo-mark")
    expect(out).toContain('class="sk')
    expect(out).not.toContain("OpsDesk")
  })
})
