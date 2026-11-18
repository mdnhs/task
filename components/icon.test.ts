import { describe, expect, it, vi } from "vitest"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { FALLBACK_ICON, ICON_NAMES, ICON_SIZES, ICON_STROKE, iconName, isIconName } from "@/components/icon"

const root = path.resolve(__dirname, "..")
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
  .toString()
  .split("\0")
  .filter(Boolean)
const source = files.filter((f) => /\.(tsx?|json|css|mjs)$/.test(f) && !f.startsWith(".claude/") && !f.startsWith("components/ui/") && !f.includes("package-lock") && !f.endsWith("components/icon.test.ts") && !f.startsWith("api/"))
const read = (f: string) => readFileSync(path.join(root, f), "utf8")

/** Quoted strings that look like an icon name inside a snippet. */
const quoted = (s: string) => [...s.matchAll(/"([a-z][a-z0-9-]*)"/g)].map((m) => m[1])

/** Every icon name used by a literal anywhere in the repo's code, config and JSON, with the file it came from. */
function usedNames() {
  const used: { name: string; file: string }[] = []
  for (const f of source) {
    const s = read(f)
    if (f.endsWith(".json")) {
      for (const m of s.matchAll(/"icon"\s*:\s*"([^"]+)"/g)) used.push({ name: m[1], file: f })
      continue
    }
    if (!/\.tsx?$/.test(f)) continue
    for (const m of s.matchAll(/<Icon\s+name="([^"]+)"/g)) used.push({ name: m[1], file: f })
    for (const m of s.matchAll(/<Icon\s+name=\{([^}]*)\}/g)) for (const n of [...m[1].matchAll(/[?:]\s*"([a-z][a-z0-9-]*)"/g)].map((x) => x[1])) used.push({ name: n, file: f })
    for (const m of s.matchAll(/(?<![-\w])icon(?:Name)?=\{?"([a-z][a-z0-9-]*)"/g)) used.push({ name: m[1], file: f })
    for (const m of s.matchAll(/\bicon\s*:\s*"([a-z][a-z0-9-]*)"/g)) used.push({ name: m[1], file: f })
    // icon lookup tables: const SOMETHING_ICONS = { key: "name", ... }
    for (const m of s.matchAll(/\b[A-Za-z_]*ICONS[A-Za-z_]*\s*(?::[^=]+)?=\s*\{([^}]*)\}/g)) for (const n of quoted(m[1].replace(/^[^:]*:/gm, ""))) used.push({ name: n, file: f })
  }
  return used
}

describe("Icon map", () => {
  it("has a name for every icon and each one is a plain kebab-case word", () => {
    expect(ICON_NAMES.length).toBeGreaterThan(100)
    for (const n of ICON_NAMES) expect(n).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(isIconName(FALLBACK_ICON)).toBe(true)
  })

  it("exposes the size tokens and the one stroke weight", () => {
    expect(ICON_SIZES.xl).toBe(20)
    expect(ICON_STROKE).toBe(1.7)
  })

  it("resolves every icon name used in code, navigation config and JSON data", () => {
    const bad = usedNames().filter((u) => !isIconName(u.name))
    expect(bad).toEqual([])
    expect(usedNames().length).toBeGreaterThan(50)
  })

  it("falls back to a neutral icon for an unknown name and logs once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(iconName("definitely-not-an-icon")).toBe(FALLBACK_ICON)
    expect(iconName("definitely-not-an-icon")).toBe(FALLBACK_ICON)
    expect(iconName(undefined)).toBe(FALLBACK_ICON)
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
    expect(iconName("roster")).toBe("roster")
  })
})
