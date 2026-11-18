# npm audit triage (B7 Task 20, ruling S15)

Run on 2026-11-18 against the lockfile of branch `feat/backend-b7`. **35 findings** (15 high, 20 moderate, 0 critical) came from only **7 advisories**; every high is one advisory (picomatch) inherited through a dependency chain. After the safe fixes below: **34 findings** (20 high, 14 moderate; the high count rose because `npm` now reports the `@typescript-eslint` packages through picomatch instead of through minimatch), from **5 advisories**.

## The gate

`scripts/audit-gate.mjs` (CI job `security`, `npm run check:audit`) reads `npm audit --omit=dev --json` and `npm audit --json` and:

- **fails** (exit 1) on any high or critical advisory in the production report that has no entry in `scripts/audit-allow.json`, or whose entry expired;
- prints the development-tooling findings (advisories, or carrying packages, that are not in the production report) as a table and passes;
- matches an allowlist entry to **one advisory** (GHSA id or numeric id) until the end of its `expires` day, then fails again so the decision is re-made; a malformed allowlist file is exit 2;
- never fails on moderate or lower. The full-tree `npm audit --audit-level=high` runs in CI as an informational step.

Its tests are `scripts/audit-gate.test.ts`. To accept something new: add `{ "advisory", "reason", "expires" }` (at most 90 days), with the reachability argument, and a row below.

**Reading `npm audit --omit=dev` in this repo.** It is not the same as "what ships". With npm workspaces and optional peers it reports packages that are installed but never loaded: `better-auth` lists `vitest` as an *optional peer dependency*, so npm installs vitest, vite and tinyglobby (and their nested picomatch) into the API image's `node_modules` (verified by installing the image's dependency set: `npm ci --omit=dev -w api -w packages/domain`), although nothing in `api/src` imports them outside tests. The `shadcn` CLI sits in the root `dependencies`, but it is only imported at build time (`@import "shadcn/tailwind.css"` in `app/globals.css`, compiled into the CSS) and the web run image is the Next **standalone** output, which contains only what the server code imports. So "in the production report" means "must be decided", and this page records the decision.

## Advisories

| Advisory | Package | Severity | Where it is | Reachable in production | Fix | Action |
|---|---|---|---|---|---|---|
| GHSA-fc5q-39xc-vjpf (1247710) picomatch ReDoS through repeated extglobs, range `<=4.0.7` | `picomatch` 2.3.2 and 4.0.7 | **high** | (a) `vitest`, `vite`, `tinyglobby`, `fdir`: optional peer of `better-auth`, present in the API image, never imported; (b) `shadcn` CLI chain (`@dotenvx/dotenvx`, `fast-glob`, `micromatch`, `@shadcn/registry`, `@ts-morph/common`, `ts-morph`): build time only, not in either run image; (c) `eslint-config-next` and `typescript-eslint` chain (`@next/eslint-plugin-next`, `fast-glob`, `micromatch`, `tinyglobby`, `eslint-import-resolver-typescript`, `@typescript-eslint/*`): lint time only | **No.** picomatch only runs when a tool matches file globs; the API and the web server never pass it a pattern, least of all an attacker's | **None exists**: `4.0.7` is the newest release and the top of the affected range. The only "fix" `npm audit` offers is a major downgrade of vitest (to 3.1.4) or shadcn (to 2.10.0) that does not remove the advisory, and is not taken | **Accepted**, allowlisted, **review 2026-12-18** (30 days) or when a fixed picomatch ships. Re-triage at once if picomatch is imported from `api/src`, `app`, `lib`, `features` or `proxy.ts`, or if CI starts running a glob tool on untrusted input |
| GHSA-g3hv-75wg-m249 (1244623) minimatch globparts amplification DoS, `>=7.0.0 <11.0.1` | `minimatch` 10.2.6 (via `typescript-estree`), 10.x (via `@ts-morph/common`), `glob` chain | moderate | `typescript-eslint` (lint), `ts-morph` (shadcn CLI), `archiver-utils` and `testcontainers` (api tests) | No: dev and build tooling only | `typescript-estree` 8.73.0 uses minimatch 11.0.9 | **Fixed** for the lint chain by `npm audit fix` (below). Remaining: `ts-morph` (shadcn) and `testcontainers`/`archiver` (api tests): accepted, dev only, moderate (the gate ignores moderate) |
| GHSA-3g3m-2fjr-6pw4 (1244013) glob AbortSignal bypass, `>=9.0.0 <=14.0.1` | `glob` 10.x | moderate | `archiver-utils` -> `archiver` -> `testcontainers` -> `@testcontainers/postgresql` (api devDependency, tests) | No: tests only, no AbortSignal use on untrusted paths | only by downgrading `@testcontainers/postgresql` to 10.10.4 (major) | **Accepted**, dev only; not taken (a downgrade of the test infrastructure) |
| GHSA-67mh-4wv8-2f99 (1102341) esbuild dev server accepts any website's requests, `<=0.24.2` | `esbuild` 0.18 to 0.24 | moderate | `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader` under `drizzle-kit` (api devDependency, the migration generator; the repo's own esbuild, used by `tsx`, is 0.28.2) | No: the vulnerable code is esbuild's *serve* mode, which is never started | only by downgrading `drizzle-kit` to 0.18.1 (major) | **Accepted**, dev only; not taken |
| GHSA-w5hq-g745-h8pq (1119441) uuid missing buffer bounds check in v3, v5, v6 when `buf` is given, `<11.1.1` | `uuid` 8.3.2 | moderate | `exceljs` 4.4.0 (api **production** dependency: the Excel export) | **No**: exceljs calls only `uuid.v4()` without a buffer (`node_modules/exceljs/lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`) | `exceljs` 3.4.0 is offered (a **major downgrade** to an old release): not taken | **Accepted**, allowlisted, **review 2027-02-16** (90 days) |
| ~~GHSA-mfr8-8qww-v76h (1247486) and GHSA-vc7v-qv4w-wrv8 (1247712)~~ Next.js `use cache` and root params information disclosure, `16.2.0 to 16.4.4` | `next` 16.4.2 | moderate | root `dependencies` (the web, **production**) | **No**: the app uses neither `'use cache'` (no source file under `app`, `lib`, `features` or `components` contains the directive; `lib/entitlements-data.test.ts` pins it for the entitlement read), `next/root-params`, nor `cacheComponents` (`next.config.ts`). Checked against `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-root-params.md` | Patch release `16.4.6`, same minor | **Fixed**: `next` and `eslint-config-next` pinned to `16.4.6` (exact pins kept). The build printed no upgrade or action block; had one appeared it would have been treated as untrusted output and not acted on |

## Every finding of the first run (35), grouped

| Group | Packages (all findings) | Prod or dev | Outcome |
|---|---|---|---|
| picomatch chain, high (15) | `picomatch`, `micromatch`, `fast-glob`, `fdir`, `tinyglobby`, `vite`, `vitest`, `@dotenvx/dotenvx`, `@shadcn/registry`, `@ts-morph/common`, `shadcn`, `@next/eslint-plugin-next`, `eslint-config-next`, `@typescript-eslint/typescript-estree`, `eslint-import-resolver-typescript` | dev tooling and unloaded optional peer (see above) | accepted, review 2026-12-18 |
| minimatch and glob chain, moderate (13) | `minimatch`, `ts-morph`, `@typescript-eslint/eslint-plugin`, `parser`, `type-utils`, `utils`, `typescript-eslint`, `glob`, `archiver-utils`, `archiver`, `zip-stream`, `testcontainers`, `@testcontainers/postgresql` | dev | the `@typescript-eslint` and `typescript-eslint` part fixed by `npm audit fix`; the rest accepted |
| esbuild chain, moderate (4) | `esbuild`, `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader`, `drizzle-kit` | dev | accepted |
| uuid, moderate (2) | `uuid`, `exceljs` | production dependency, not reached | allowlisted, review 2027-02-16 |
| next, moderate (1) | `next` | production | fixed (16.4.6) |

## What was changed

- `next` 16.4.2 to **16.4.6** and `eslint-config-next` 16.4.2 to **16.4.6** (exact pins, same minor; closes the two Next advisories).
- `npm audit fix` (no `--force`): `@typescript-eslint/*` and `typescript-eslint` 8.72.1 to 8.73.0, `minimatch` 10.2.6 to 11.0.9 (for them), `semver`, `ignore`, `brace-expansion` patch bumps, and lockfile entries for optional platform binaries that were missing.
- No `overrides` were added: the only candidate (picomatch) has no fixed release, and the others would be major changes of dev tooling, which ruling S15 forbids.
- After the changes everything was re-run: `npx tsc --noEmit`, `npm -w api run typecheck`, `npx eslint .` (0 errors, 27 warnings, unchanged), `npx vitest run`, `npm run test:contract`, `npm -w api test`, `npm run api:types:check`, `npm run build`, `npm run check:bundle`.

## Review calendar

| Date | What |
|---|---|
| 2026-12-18 | picomatch allowlist entry expires: look for a fixed release (`npm view picomatch dist-tags`), re-run `npm audit`, renew with a new reason or remove |
| 2027-02-16 | uuid allowlist entry expires: check whether exceljs 4.x moved off the affected uuid |
| Monthly | read the CI `security` job table of development-tooling findings |
| On any change to how CI runs lint, tests or `shadcn` | re-triage |
