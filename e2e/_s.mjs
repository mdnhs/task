import { chromium } from "@playwright/test"
const b = await chromium.launch()
const ctx = await b.newContext({ storageState: `/Users/nazmulhasansourab/ireland/task/e2e/.auth/platform.json`, viewport: { width: 1568, height: 900 } })
const p = await ctx.newPage()
await p.goto("http://localhost:3100/platform", { waitUntil: "networkidle" })
console.log(await p.evaluate(() => { const m = document.querySelector("main"); const t = m.getBoundingClientRect().top; return [...m.querySelectorAll("*")].map((e) => [e.tagName + "." + e.className, Math.round(e.getBoundingClientRect().bottom - t)]).sort((a, b) => b[1] - a[1]).slice(0, 4).join("\n") }))
await b.close()
