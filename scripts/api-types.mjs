#!/usr/bin/env node
// Generates lib/api/schema.d.ts from the API's OpenAPI document (B6 ruling I2: no hc<AppType>, no packages/contracts).
//   node scripts/api-types.mjs                       regenerate lib/api/schema.d.ts
//   node scripts/api-types.mjs --check               fail (exit 1) when the committed file is stale; writes nothing
//   --doc <openapi.json>   use this document instead of dumping the live app (tests use it to simulate a changed DTO)
//   --out <file>           the file to write or compare (default lib/api/schema.d.ts)
// openapi-typescript is a devDependency used here only; nothing generated or imported at runtime pulls server code into the bundle.
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import openapiTS, { astToString } from "openapi-typescript"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const check = flag("--check")
const out = path.resolve(root, value("--out") ?? "lib/api/schema.d.ts")

const HEADER = `/**
 * GENERATED FILE: do not edit by hand.
 * Source: the API's OpenAPI 3.1 document (api/scripts/dump-openapi.ts) through openapi-typescript.
 * Regenerate with \`npm run api:types\`; CI fails (\`npm run api:types:check\`) when this file is stale.
 */

`

async function generate() {
  let doc = value("--doc")
  let tmp
  if (!doc) {
    tmp = mkdtempSync(path.join(tmpdir(), "opsdesk-openapi-"))
    doc = path.join(tmp, "openapi.json")
    const tsx = path.join(root, "node_modules/.bin/tsx")
    if (!existsSync(tsx)) throw new Error("tsx is not installed: run npm ci")
    execFileSync(tsx, [path.join(root, "api/scripts/dump-openapi.ts"), doc], { cwd: root, stdio: ["ignore", "ignore", "inherit"] })
  }
  try {
    const ast = await openapiTS(pathToFileURL(path.resolve(doc)), { alphabetize: false, exportType: false, immutable: false })
    return HEADER + astToString(ast)
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  }
}

const next = await generate()
if (check) {
  const current = existsSync(out) ? readFileSync(out, "utf8") : ""
  if (current !== next) {
    console.error(`${path.relative(root, out)} is stale: the API's OpenAPI document changed. Run \`npm run api:types\` and commit the result.`)
    process.exit(1)
  }
  console.log(`${path.relative(root, out)} is current`)
} else {
  writeFileSync(out, next)
  console.log(`wrote ${path.relative(root, out)}`)
}
