import { chromium } from "@playwright/test"
const b = await chromium.launch()
const ctx = await b.newContext({ storageState: `/Users/nazmulhasansourab/ireland/task/e2e/.auth/owner.json`, viewport: { width: 1568, height: 900 } })
const p = await ctx.newPage()
await p.goto("http://localhost:3100/tasks", { waitUntil: "networkidle" })
console.log(await p.evaluate(() => { const td = document.querySelector(".tasks-table tbody tr td"); return td.outerHTML.slice(0, 700) + "\n" + [...td.querySelectorAll("*")].map((e) => e.className + ":" + Math.round(e.getBoundingClientRect().height * 10) / 10).join(" | ") }))
await b.close()
