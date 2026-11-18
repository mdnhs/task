import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { expect, test } from "vitest"

// reveal-observer sets data-inview on a .progress element that is already on screen before React hydrates it, so a server-rendered progress bar that does not say
// suppressHydrationWarning logs a hydration mismatch in dev (found in the T6.9 browser walk on the evidence meter).
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? (n === "node_modules" ? [] : walk(p)) : [p] })

test("every rendered .progress bar tolerates the reveal observer's data-inview", () => {
  const offenders = ["app", "features", "components"].flatMap(walk).filter((f) => f.endsWith(".tsx") && !f.endsWith("skeletons.tsx") && !f.endsWith(".test.tsx")).flatMap((f) =>
    readFileSync(f, "utf8").split("\n").map((l, i) => ({ f, i: i + 1, l })).filter(({ l }) => /<div[^>]*className="progress[ "]/.test(l) && !l.includes("suppressHydrationWarning")).map(({ f, i }) => `${f}:${i}`),
  )
  expect(offenders).toEqual([])
})
