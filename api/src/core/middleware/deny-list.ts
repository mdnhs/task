/**
 * Canonical route deny-list matching, shared by the non-session principals of requireTenant: support grants (support.ts) and
 * API keys (api-key.ts). Rules are matched against the matched route TEMPLATE (c.req.routePath, e.g. /v1/files/:id/download:
 * canonical, immune to encoding tricks) AND the decoded request path, both lower-cased with repeated/trailing slashes
 * collapsed. A rule is a path prefix (the path itself or anything below it) or a regular expression.
 */
export type DenyRule = { readonly why: string } & ({ readonly prefix: string } | { readonly pattern: RegExp })

const norm = (p: string) => p.toLowerCase().replace(/\/{2,}/g, "/").replace(/(.)\/$/, "$1")
const ruleHits = (r: DenyRule, p: string) => ("prefix" in r ? p === r.prefix || p.startsWith(`${r.prefix}/`) : r.pattern.test(p))

/** Any present or future export / download route, whatever module adds it. */
export const EXPORT_OR_DOWNLOAD: DenyRule = { pattern: /\/[^/]*(export|download)[^/]*(\/|$)/, why: "any data export or download route" }

/** True when the route (template or path) matches any rule. */
export function routeDenied(rules: readonly DenyRule[], routePath: string, path: string): boolean {
  const cands = [norm(routePath), norm(path)]
  return rules.some((r) => cands.some((p) => ruleHits(r, p)))
}
