import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

// The tenant portal never shows the word "tenant" to its users (they say workspace / organization; a role is "Owner", not "Tenant Owner").
// This scans the copy sources of the tenant app for the word in a string literal or JSX text. Not scanned: the platform console (platform staff manage
// tenants), tests, generated API types, migrations, docs, comments, and identifiers/keys (tenantId, od-tenant, /v1/me/tenant, "tenant.created" have no spaces).

const ROOTS = ["app", "features", "components", "lib", "hooks", "public/data"]
const SKIP = [/node_modules/, /\.next/, /schema\.d\.ts$/, /\.test\.tsx?$/, /\.css$/, /^app\/\(platform\)\//, /^features\/platform\//, /^public\/data\/platform\//]

// Explicit allowlist: [file, exact text]. Each is platform-console-only copy or a non-user-facing string.
const ALLOW: [string, string][] = [
  ["features/search/match.ts", "Tenants"], // platform console search group label (type "tenant" exists only in the console index)
  ["lib/api/problem.ts", "This tenant is already suspended."], // platform console action errors (suspend / resume / extend trial / support grant)
  ["lib/api/problem.ts", "This tenant is not suspended."],
  ["lib/api/problem.ts", "This tenant is not on a trial."],
  ["lib/api/problem.ts", "You already have access to this tenant. Revoke it first."],
  ["public/data/shell/roles.json", "SaaS operator across all tenants."], // the platform staff role template (never listed in a tenant)
  ["lib/mock-registry.ts", "entitlement catalogue and plan list (the tenant's own state is the API's)"], // developer-facing registry notes
  ["lib/skeleton-session.ts", "shell/roles.json has no tenant role"], // thrown developer error
  ["lib/tenant-cookie.ts", "not a tenant slug"], // thrown developer error
]

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.posix.join(dir, e.name)
    if (SKIP.some((re) => re.test(p))) continue
    if (e.isDirectory()) walk(p, out)
    else if (/\.(tsx?|json)$/.test(e.name)) out.push(p)
  }
  return out
}

const WORD = /\btenants?\b/i
const proseLike = (s: string) => /\bTenants?\b/.test(s) || /[A-Za-z]{2,} [A-Za-z]/.test(s)

// Every string literal, template chunk and JSX text of a TS/TSX file (comments are not nodes, so they never match), or every string value of a JSON file.
function textsOf(file: string, src: string): string[] {
  if (file.endsWith(".json")) {
    const out: string[] = []
    const visit = (v: unknown): void => {
      if (typeof v === "string") out.push(v)
      else if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === "object") Object.values(v).forEach(visit)
    }
    visit(JSON.parse(src))
    return out
  }
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text)
    else if (ts.isJsxText(n)) out.push(n.text.replace(/\s+/g, " ").trim())
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

export function findTenantCopy(file: string, src: string): string[] {
  return textsOf(file, src)
    .filter((t) => WORD.test(t) && proseLike(t))
    .filter((t) => !ALLOW.some(([f, a]) => f === file && t.includes(a)))
}

describe("tenant portal copy never says 'tenant'", () => {
  const files = ROOTS.flatMap((r) => walk(r))

  it("scans the real copy sources", () => {
    expect(files.length).toBeGreaterThan(100)
    expect(files).toContain("lib/api/problem.ts")
    expect(files).toContain("public/data/shell/roles.json")
    expect(files.some((f) => f.startsWith("app/(platform)/") || f.startsWith("features/platform/"))).toBe(false)
  })

  it("no user-facing string, label or JSX text in the tenant app contains the word", () => {
    const hits = files.flatMap((f) => findTenantCopy(f, readFileSync(f, "utf8")).map((t) => `${f}: ${t}`))
    expect(hits).toEqual([])
  })

  it("the detector itself catches the old copy", () => {
    expect(findTenantCopy("x.ts", `const a = { label: "Tenant Owner" }`)).toEqual(["Tenant Owner"])
    expect(findTenantCopy("x.ts", `toast("This tenant is gone")`)).toEqual(["This tenant is gone"])
    expect(findTenantCopy("x.tsx", `<p>\n  Ask your Tenant admin\n</p>`)).toEqual(["Ask your Tenant admin"])
    expect(findTenantCopy("x.ts", `const k = "od-tenant"; // Tenant Owner\nfetch("/v1/me/tenant")`)).toEqual([])
    expect(findTenantCopy("x.json", `{"label":"Tenant Admin"}`)).toEqual(["Tenant Admin"])
  })

  it("role labels are neutral: the owner is 'Owner'", () => {
    const roles = JSON.parse(readFileSync("public/data/shell/roles.json", "utf8")).roles as { id: string; label: string }[]
    expect(roles.find((r) => r.id === "owner")?.label).toBe("Owner")
    expect(roles.find((r) => r.id === "admin")?.label).toBe("Admin")
  })
})
