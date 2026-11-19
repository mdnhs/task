import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

// Feature boundaries (architecture.md): a feature is imported only through its index.ts, and features do not reach into each other.
const root = path.resolve(__dirname, "../..")
const files = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const f = path.join(dir, e)
    if (["node_modules", ".next", ".local-run"].includes(e)) continue
    if (statSync(f).isDirectory()) files(f, out)
    else if (/\.(ts|tsx)$/.test(e)) out.push(f)
  }
  return out
}
const specifiers = (src: string) => [...src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((m) => m[1]!)

describe("no import from another feature except through its index.ts", () => {
  const mine = files(path.join(root, "features/rosters")).filter((f) => !f.endsWith(".test.ts"))
  it("the rosters feature imports no other feature's files, and no other feature at all except through its index", () => {
    for (const f of mine) for (const s of specifiers(readFileSync(f, "utf8"))) {
      const m = s.match(/^@\/features\/([^/]+)(\/.*)?$/)
      if (m && m[1] !== "rosters") expect(m[2], `${path.relative(root, f)} imports ${s}`).toBeUndefined()
      expect(/^(\.\.\/)+features\//.test(s), `${path.relative(root, f)} imports ${s}`).toBe(false)
    }
  })
  it("nothing outside the feature imports the rosters files, only its index", () => {
    const others = [...files(path.join(root, "app")), ...files(path.join(root, "features")), ...files(path.join(root, "lib")), ...files(path.join(root, "components")), ...files(path.join(root, "hooks"))]
      .filter((f) => !f.includes(`${path.sep}features${path.sep}rosters${path.sep}`) && !f.endsWith(".test.ts"))
    const offenders: string[] = []
    for (const f of others) for (const s of specifiers(readFileSync(f, "utf8"))) if (/^@\/features\/rosters\/./.test(s)) offenders.push(`${path.relative(root, f)} imports ${s}`)
    expect(offenders).toEqual([])
  })
})
