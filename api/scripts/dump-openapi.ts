// Writes the API's OpenAPI 3.1 document (B6 ruling I2: the web types are generated from it, `hc<AppType>` carries no routes).
//   tsx api/scripts/dump-openapi.ts <out.json>        (stdout when no path is given)
// The app is built with stub dependencies: only routes are registered, nothing connects to a database, a queue or a provider, and the
// stub throws if a handler is ever run. NODE_ENV is "production" so the test-only routes (probes) are not in the document.
import { writeFileSync } from "node:fs"
import { createApp } from "../src/app"
import type { Deps } from "../src/deps"

const silent = { info() {}, warn() {}, error() {}, debug() {}, fatal() {}, trace() {}, child() { return silent } }
const stub = (name: string) =>
  new Proxy({}, { get: () => { throw new Error(`dump-openapi: ${name} is a stub; a handler must not run here`) } })

export function buildDoc() {
  const deps = {
    env: { NODE_ENV: "production", APP_URL: "http://localhost:3000" },
    logger: silent,
    db: stub("db"), auth: stub("auth"), clock: stub("clock"), mailer: stub("mailer"), queue: stub("queue"), push: stub("push"),
    storage: stub("storage"), scanner: stub("scanner"), oauth: stub("oauth"), billing: stub("billing"), net: stub("net"),
  } as unknown as Deps
  return createApp(deps).getOpenAPI31Document({ openapi: "3.1.0", info: { title: "OpsDesk API", version: "1" } })
}

const out = process.argv[2]
const json = JSON.stringify(buildDoc(), null, 2) + "\n"
if (out) writeFileSync(out, json)
else process.stdout.write(json)
