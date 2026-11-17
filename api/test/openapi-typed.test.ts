import { expect, test } from "vitest"
import { testApp } from "./harness"

/**
 * B6 T6.1 (ruling I2): the web types come from this document, so a 2xx JSON response that is `{}` (z.any / z.unknown) would become `unknown`
 * in lib/api/schema.d.ts and a renamed field would silently show wrong data (Review Focus 4). Walks every 2xx application/json response.
 */
type Schema = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** Free-form values that are DATA by design (audit before/after snapshots): the only allow-list entries. */
const ALLOWED = [/^GET \/v1\/audit 200 .*\.(before|after)$/, /^GET \/v1\/platform\/audit 200 .*\.(before|after)$/]

const STRUCTURAL = ["type", "properties", "$ref", "enum", "const", "oneOf", "anyOf", "allOf", "items", "prefixItems", "format", "not", "if"]
export const isEmptySchema = (s: Schema): boolean => !STRUCTURAL.some((k) => k in s)

function walk(s: Schema | undefined, at: string, doc: Schema, out: string[], seen: Set<string>): void {
  if (!s) return
  if (s.$ref) {
    if (seen.has(s.$ref)) return
    seen.add(s.$ref)
    const target = String(s.$ref).replace(/^#\//, "").split("/").reduce<Schema | undefined>((o: Schema | undefined, k: string) => o?.[k], doc)
    walk(target, at, doc, out, seen)
    return
  }
  if (isEmptySchema(s)) {
    out.push(at)
    return
  }
  for (const [k, v] of Object.entries<Schema>(s.properties ?? {})) walk(v, `${at}.${k}`, doc, out, new Set(seen))
  if (s.items) walk(s.items, `${at}[]`, doc, out, new Set(seen))
  if (s.additionalProperties && typeof s.additionalProperties === "object") walk(s.additionalProperties, `${at}{}`, doc, out, new Set(seen))
  for (const k of ["oneOf", "anyOf", "allOf"]) for (const v of (s[k] ?? []) as Schema[]) walk(v, at, doc, out, new Set(seen))
}

test("OpenAPI has no untyped 2xx JSON response: no empty schema (z.any / z.unknown) anywhere in a body, except audit before/after", () => {
  const { app } = testApp()
  const doc = app.getOpenAPI31Document({ openapi: "3.1.0", info: { title: "t", version: "1" } }) as Schema
  const bad: string[] = []
  let checked = 0
  for (const [path, item] of Object.entries<Schema>(doc.paths ?? {})) {
    if (path.startsWith("/v1/_probe")) continue // test-only
    for (const [method, op] of Object.entries<Schema>(item)) {
      for (const [status, res] of Object.entries<Schema>(op.responses ?? {})) {
        if (!/^2/.test(status)) continue
        const schema = res.content?.["application/json"]?.schema as Schema | undefined
        if (!schema) continue
        checked++
        const found: string[] = []
        walk(schema, "body", doc, found, new Set())
        for (const f of found) {
          const id = `${method.toUpperCase()} ${path} ${status} ${f}`
          if (!ALLOWED.some((re) => re.test(id))) bad.push(id)
        }
      }
    }
  }
  expect(checked).toBeGreaterThan(100)
  expect(bad).toEqual([])
})

test("the walker really flags an empty schema (guard against a vacuous pass)", () => {
  const out: string[] = []
  walk({ type: "object", properties: { a: {}, b: { type: "array", items: {} }, c: { type: "string" } } }, "body", {}, out, new Set())
  expect(out).toEqual(["body.a", "body.b[]"])
})
