import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const src = readFileSync("features/shell/components/nav-user.tsx", "utf8")

describe("nav-user menu", () => {
  it("renders exactly one divider, before the session actions (Help, Log out)", () => {
    const seps = src.match(/<DropdownMenuSeparator\s*\/>/g) ?? []
    expect(seps).toHaveLength(1)
    // the single separator sits right before Help, for every role variant
    expect(src).toMatch(/<DropdownMenuSeparator \/>\s*<DropdownMenuItem>\s*<CircleHelp/)
  })
})
