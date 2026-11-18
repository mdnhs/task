import { readFileSync } from "node:fs"
import { createElement } from "react"
import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { DndContext } from "@dnd-kit/core"
import { describe, expect, it } from "vitest"
import { ShiftLine } from "./day-board"
import type { ViewShift } from "../view"

const s = { id: "s1", person: "A. Kowalski", start: "18:00", end: "02:00", endsNextDay: true, role: "Security Officer", open: false } as unknown as ViewShift
const html = (el: ReactElement) => renderToStaticMarkup(createElement(DndContext, null, el))
const css = (f: string) => readFileSync(new URL(`../../../app/styles/${f}`, import.meta.url), "utf8")

describe("roster shift card", () => {
  it("editable card shares the kanban drag style and shows the grip", () => {
    const m = html(createElement(ShiftLine, { s, card: true, onEdit: () => {} }))
    expect(m).toContain("ros-scard")
    expect(m).toContain("dnd-card")
    expect(m).toContain("dnd-grip")
    expect(m).toContain('aria-roledescription="draggable"')
  })
  it("read-only and request-only cards are not draggable", () => {
    for (const m of [html(createElement(ShiftLine, { s, card: true })), html(createElement(ShiftLine, { s, card: true, onRequest: () => {} }))]) {
      expect(m).toContain("ros-scard")
      expect(m).not.toContain("dnd-card")
      expect(m).not.toContain("dnd-grip")
      expect(m).not.toContain("draggable")
    }
  })
  it("uses the kanban card tokens and the shared drag css (grab cursor only on .dnd-card)", () => {
    const ros = css("rosters.css")
    expect(ros).toMatch(/\.ros-scard\{[^}]*padding:12px;border-radius:var\(--r-md\);background:var\(--card\)/)
    expect(css("recruitment.css")).toMatch(/\.rec-card\{[^}]*padding:12px;border-radius:var\(--r-md\);background:var\(--card\)/)
    expect(css("drag.css")).toContain(".dnd-card{cursor:grab")
    expect(ros).not.toContain("cursor:grab")
  })
})
