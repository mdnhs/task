import { chromium } from "@playwright/test"
const [,, persona, path, width, sel] = process.argv
const b = await chromium.launch()
const ctx = await b.newContext({ storageState: `/Users/nazmulhasansourab/ireland/task/e2e/.auth/${persona}.json`, viewport: { width: +width, height: 900 } })
const p = await ctx.newPage()
await p.goto("http://localhost:3100" + path, { waitUntil: "networkidle" })
console.log(await p.evaluate((s) => [...document.querySelectorAll(s)].map((e) => `${e.tagName}.${e.className} h=${e.getBoundingClientRect().height} kids=[${[...e.children].map((c) => c.tagName + "." + c.className + ":" + Math.round(c.getBoundingClientRect().height)).join(", ")}]`).join("\n"), sel))
await b.close()
