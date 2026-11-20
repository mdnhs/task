import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, test } from "vitest"
import { parse } from "yaml"

// B7 Task 19: parse-only checks of the Dokploy deploy files and docs (no docker needed, except the one marked self-test).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8")
const COMPOSE_PATH = "deploy/docker-compose.prod.yml"
const DEMO_PATH = "deploy/docker-compose.dokploy-demo.yml"
type Service = { depends_on?: Record<string, { condition?: string }>; networks?: string[]; restart?: string; expose?: unknown[]; stop_grace_period?: string; logging?: unknown; labels?: unknown; container_name?: string; build?: { context: string; dockerfile?: string; target?: string }; image?: string; profiles?: string[]; healthcheck?: { test: unknown }; environment?: Record<string, unknown>; command?: string[]; volumes?: string[]; ports?: unknown }
const compose = parse(read(COMPOSE_PATH), { merge: true }) as { services: Record<string, Service> }
const services = Object.entries(compose.services)
const DEPLOY_DOCS = readdirSync(resolve(ROOT, ".claude/docs/deploy")).filter((f) => f.endsWith(".md"))

/** Stage names of a Dockerfile. */
const stagesOf = (p: string) => [...read(p).matchAll(/^FROM\s+\S+(?:\s+AS\s+(\S+))?/gim)].map((m) => m[1]).filter(Boolean) as string[]

describe("deploy/docker-compose.prod.yml", () => {
  test("parses, has the listed services, and every service has a healthcheck except the one-shot profiles", () => {
    expect(Object.keys(compose.services).sort()).toEqual(["api", "clamav", "migrate", "minio", "postgres", "redis", "seed", "web", "worker"])
    for (const [name, s] of services) {
      const oneShot = s.profiles?.some((p) => p === "ops" || p === "demo")
      if (oneShot) expect(s.healthcheck, name).toBeUndefined()
      else expect(s.healthcheck?.test, `${name} needs a healthcheck`).toBeTruthy()
    }
  })

  test("profiles: migrate is ops, seed is demo, postgres and minio are local only, nothing else has a profile", () => {
    const profiles = Object.fromEntries(services.map(([n, s]) => [n, s.profiles ?? []]))
    expect(profiles).toMatchObject({ migrate: ["ops"], seed: ["demo"], postgres: ["local"], minio: ["local"], web: [], api: [], worker: [], redis: [], clamav: [] })
  })

  test("no secret value is literal and no port is published", () => {
    const SECRETISH = /(SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL|DATABASE_OWNER_URL|REDIS_URL|TOTP)/
    for (const [name, s] of services) {
      for (const [k, v] of Object.entries(s.environment ?? {})) {
        if (SECRETISH.test(k) && !/_ID$|_MAX_BYTES$/.test(k)) expect(String(v), `${name}.${k} must be a \${VAR} reference`).toMatch(/\$\{/)
      }
      expect(s.ports, `${name} must not publish a port (Traefik reaches it through the Dokploy domain)`).toBeUndefined()
    }
    expect(read(COMPOSE_PATH)).not.toMatch(/sk_(live|test)_|whsec_|odk_|BEGIN [A-Z ]*PRIVATE KEY/)
    expect(compose.services.api.environment?.METRICS_PORT).toBeDefined() // internal port, never published (checked above)
  })

  test("the worker runs the api image with the worker command and a Redis heartbeat check; migrate runs migrate.sh as the owner only", () => {
    const w = compose.services.worker
    expect(w.image).toBe(compose.services.api.image)
    expect(w.command).toEqual(["../node_modules/.bin/tsx", "src/worker.ts"])
    expect(JSON.stringify(w.healthcheck?.test)).toContain("worker-healthcheck.mjs")
    expect(w.ports).toBeUndefined()
    const m = compose.services.migrate
    expect(Object.keys(m.environment ?? {})).toEqual(["DATABASE_OWNER_URL"])
    expect(m.command).toEqual(["sh", "/opt/deploy/migrate.sh"])
    expect(m.volumes?.[0]).toMatch(/^\.\/scripts\/migrate\.sh:/)
  })

  test("api and worker are not given DATABASE_OWNER_URL (DDL-capable); only migrate and the demo seed are", () => {
    for (const n of ["api", "worker", "web"]) expect(Object.keys(compose.services[n].environment ?? {}), n).not.toContain("DATABASE_OWNER_URL")
    expect(Object.keys(compose.services.migrate.environment ?? {})).toContain("DATABASE_OWNER_URL")
  })

  test("ALLOW_NO_PROXY is passed through (empty by default) and the api healthcheck is liveness (/healthz), never /readyz", () => {
    expect(String(compose.services.api.environment?.ALLOW_NO_PROXY)).toContain("ALLOW_NO_PROXY:-")
    expect(JSON.stringify(compose.services.api.healthcheck?.test)).toContain("/healthz")
    expect(JSON.stringify(compose.services.api.healthcheck?.test)).not.toContain("/readyz")
  })

  test("files the compose file points at exist", () => {
    for (const rel of ["deploy/scripts/migrate.sh", "deploy/scripts/restore-drill.sh", "api/scripts/worker-healthcheck.mjs", "api/scripts/migrate.ts", "api/scripts/restore-verify.ts", "api/src/worker.ts", "api/src/server.ts", "api/src/db/bootstrap/roles.sql"]) {
      expect(existsSync(resolve(ROOT, rel)), rel).toBe(true)
    }
  })

  test("the Dockerfile targets named in compose exist", () => {
    for (const [name, s] of services) {
      if (!s.build) continue
      const file = resolve(ROOT, "deploy", s.build.context, s.build.dockerfile ?? "Dockerfile")
      const rel = file.slice(ROOT.length + 1)
      expect(existsSync(file), `${name}: ${rel}`).toBe(true)
      expect(stagesOf(rel), `${name} target ${s.build.target} in ${rel}`).toContain(s.build.target)
    }
    // the api's run stage is the last stage (a plain build is the API) and it carries a liveness healthcheck
    const api = stagesOf("api/Dockerfile")
    expect(api.at(-1)).toBe("run")
    expect(read("api/Dockerfile")).toMatch(/HEALTHCHECK[\s\S]*\/healthz/)
    expect(read("Dockerfile")).toMatch(/HEALTHCHECK[\s\S]*\/sign-in/)
  })
})

describe("deploy/docker-compose.dokploy-demo.yml", () => {
  const demoText = read(DEMO_PATH)
  const demo = parse(demoText, { merge: true }) as { services: Record<string, Service>; networks?: Record<string, { external?: boolean }> }
  const dsv = Object.entries(demo.services)
  const NET = ["default", "dokploy-network"]

  test("every deploy file in deploy/ is a known compose variant (a new one must be covered here)", () => {
    expect(readdirSync(resolve(ROOT, "deploy")).filter((f) => /\.ya?ml$/.test(f)).sort()).toEqual(["docker-compose.dokploy-demo.yml", "docker-compose.prod.yml"])
  })

  test("services: prod's api, worker, web, redis, clamav, migrate, seed plus a bootstrap; no local postgres or minio", () => {
    expect(Object.keys(demo.services).sort()).toEqual(["api", "bootstrap", "clamav", "migrate", "redis", "seed", "web", "worker"])
    expect(demo.networks?.["dokploy-network"]?.external).toBe(true)
  })

  test("only seed is profile-gated (demo); bootstrap and migrate are normal one-shots; every long-running service has a healthcheck", () => {
    for (const [name, s] of dsv) {
      if (name === "seed") expect(s.profiles).toEqual(["demo"])
      else expect(s.profiles, name).toBeUndefined()
      if (["bootstrap", "migrate", "seed"].includes(name)) { expect(s.restart, name).toBe("no"); expect(s.healthcheck, name).toBeUndefined() }
      else expect(s.healthcheck?.test, `${name} needs a healthcheck`).toBeTruthy()
    }
  })

  test("dependency chain: bootstrap -> migrate -> api and worker -> web", () => {
    const d = demo.services
    expect(d.migrate.depends_on?.bootstrap?.condition).toBe("service_completed_successfully")
    for (const n of ["api", "worker"]) expect(d[n].depends_on?.migrate?.condition, n).toBe("service_completed_successfully")
    expect(d.web.depends_on?.api?.condition).toBe("service_healthy")
  })

  test("networks: api, worker, migrate, bootstrap and seed join dokploy-network; web, redis and clamav do not", () => {
    for (const n of ["api", "worker", "migrate", "bootstrap", "seed"]) expect([...(demo.services[n].networks ?? [])].sort(), n).toEqual(NET)
    for (const n of ["web", "redis", "clamav"]) expect(demo.services[n].networks, n).toBeUndefined()
  })

  test("no published port, no container_name, no Traefik labels, no literal secret", () => {
    const SECRETISH = /(SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL|DATABASE_OWNER_URL|PG_SUPERUSER_URL|REDIS_URL|TOTP)/
    for (const [name, s] of dsv) {
      expect(s.ports, `${name} ports`).toBeUndefined()
      expect(s.container_name, `${name} container_name`).toBeUndefined()
      expect(s.labels, `${name} labels`).toBeUndefined()
      for (const [k, v] of Object.entries(s.environment ?? {})) {
        if (SECRETISH.test(k) && !/_ID$|_MAX_BYTES$/.test(k)) expect(String(v), `${name}.${k} must be a \${VAR} reference`).toMatch(/\$\{/)
      }
    }
    expect(demoText).not.toMatch(/traefik\./)
    expect(demoText).not.toMatch(/sk_(live|test)_|whsec_|odk_|BEGIN [A-Z ]*PRIVATE KEY/)
    expect(demo.services.web.expose).toEqual(["3000"])
    expect(demo.services.api.expose).toEqual(["8080"])
    expect(String(demo.services.api.environment?.METRICS_HOST)).toBe("0.0.0.0")
  })

  test("hardening kept: logging, stop_grace_period, liveness healthcheck, shared api env", () => {
    for (const n of ["web", "api", "worker", "redis", "clamav"]) expect(demo.services[n].logging, n).toBeTruthy()
    expect(demo.services.api.stop_grace_period).toBe("30s")
    expect(demo.services.worker.stop_grace_period).toBe("60s")
    expect(JSON.stringify(demo.services.api.healthcheck?.test)).toContain("/healthz")
    expect(demoText).toContain("x-api-env: &api-env")
    for (const k of Object.keys(parse(read(COMPOSE_PATH), { merge: true }).services.api.environment)) expect(Object.keys(demo.services.api.environment ?? {}), `api env ${k} (same as prod)`).toContain(k)
    expect(demo.services.worker.image).toBe(demo.services.api.image)
  })

  test("DATABASE_OWNER_URL only on migrate and seed; the superuser URL only on bootstrap", () => {
    for (const [name, s] of dsv) {
      const keys = Object.keys(s.environment ?? {})
      if (name === "migrate" || name === "seed") expect(keys, name).toContain("DATABASE_OWNER_URL")
      else expect(keys, name).not.toContain("DATABASE_OWNER_URL")
      if (name === "bootstrap") expect(keys.sort()).toEqual(["APP_OWNER_PASSWORD", "APP_USER_PASSWORD", "PG_SUPERUSER_URL"])
      else expect(keys, name).not.toContain("PG_SUPERUSER_URL")
    }
    expect(Object.keys(demo.services.migrate.environment ?? {})).toEqual(["DATABASE_OWNER_URL"])
  })

  test("bootstrap: postgres:16 client, roles.sql mounted read-only, passwords via \\getenv (never -v or argv), bounded wait, ON_ERROR_STOP, pg_trgm", () => {
    const b = demo.services.bootstrap
    expect(b.image).toMatch(/^postgres:16/)
    expect(b.volumes?.[0]).toBe("../api/src/db/bootstrap/roles.sql:/opt/bootstrap/roles.sql:ro")
    const script = (b.command ?? []).join("\n")
    expect(script).toContain("pg_isready")
    expect(script).toMatch(/-ge \d+/)
    expect(script).toContain("ON_ERROR_STOP=1")
    expect(script).toContain("\\getenv owner_pw APP_OWNER_PASSWORD")
    expect(script).toContain("\\getenv user_pw APP_USER_PASSWORD")
    expect(script).toContain("ALTER ROLE app_owner LOGIN PASSWORD :'owner_pw'")
    expect(script).toContain("ALTER ROLE app_user LOGIN PASSWORD :'user_pw'")
    expect(script).toContain("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    expect(script).not.toMatch(/-v\s+\w*pw\w*=|PASSWORD\s+'/) // no password on a command line or inline literal
  })

  test("files and Dockerfile targets the demo file points at exist", () => {
    expect(existsSync(resolve(ROOT, "api/src/db/bootstrap/roles.sql"))).toBe(true)
    for (const [name, s] of dsv) {
      if (!s.build) continue
      const rel = resolve(ROOT, "deploy", s.build.context, s.build.dockerfile ?? "Dockerfile").slice(ROOT.length + 1)
      expect(stagesOf(rel), `${name} target ${s.build.target}`).toContain(s.build.target)
    }
  })

  test("the header says it auto-migrates because it is demo-only and points production at docker-compose.prod.yml", () => {
    expect(demoText).toMatch(/AUTO-MIGRATES ON EACH DEPLOY ONLY BECAUSE IT TARGETS THE DEMO DATABASE/)
    expect(demoText).toMatch(/PRODUCTION deploy MUST use docker-compose\.prod\.yml/)
  })
})

describe("env matrix", () => {
  const matrix = read(".claude/docs/deploy/env-matrix.md")
  const mentioned = (name: string) => new RegExp("`" + name + "`").test(matrix)

  test("every env var read by api/src/env.ts appears in the env matrix doc", () => {
    const schemaKeys = [...read("api/src/env.ts").matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map((m) => m[1])
    expect(schemaKeys.length).toBeGreaterThan(30)
    expect(schemaKeys.filter((k) => !mentioned(k))).toEqual([])
  })

  test("every env var the web reads (process.env.*, outside tests) and every script variable appears in the matrix", () => {
    const files: string[] = []
    const walk = (d: string) => {
      for (const e of readdirSync(resolve(ROOT, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`
        if (e.isDirectory()) { if (!["node_modules", ".next", "test"].includes(e.name)) walk(rel) } else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(rel)
      }
    }
    for (const d of ["app", "lib", "features", "components", "hooks"]) walk(d)
    files.push("proxy.ts", "instrumentation.ts", "instrumentation-node.ts", "next.config.ts")
    const names = new Set<string>()
    for (const f of files) for (const m of read(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1])
    for (const f of ["api/scripts/seed-demo.ts", "api/scripts/load-prepare.ts", "api/scripts/restore-verify.ts", "api/scripts/migrate.ts", "api/src/seed/demo/seed.ts"]) for (const m of read(f).matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) names.add(m[1])
    for (const n of ["API_URL", "APP_ORIGIN", "ENABLE_MOCK_MODULES"]) expect(names.has(n), n).toBe(true) // the grep really sees the web's variables
    const IGNORED = new Set(["PATH", "HOME"]) // the shell's, not ours
    expect([...names].filter((n) => !IGNORED.has(n) && !mentioned(n)).sort()).toEqual([])
  })

  test("every variable the compose file interpolates is in the matrix doc and in deploy/.env.matrix.example (names only, no real value)", () => {
    const text = read(COMPOSE_PATH) + read(DEMO_PATH)
    const vars = new Set([...text.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))
    const example = read("deploy/.env.matrix.example")
    for (const v of vars) {
      expect(mentioned(v), `${v} in env-matrix.md`).toBe(true)
      expect(example, `${v} in .env.matrix.example`).toMatch(new RegExp(`^${v}=`, "m"))
    }
    for (const line of example.split("\n")) {
      const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line)
      if (m) expect(m[2] === "" || m[2] === "CHANGE_ME", `${m[1]} must be empty or CHANGE_ME`).toBe(true)
    }
  })
})

describe("deploy docs", () => {
  test("the runbooks the task lists exist", () => {
    for (const f of ["dokploy.md", "env-matrix.md", "backup-restore.md", "migrations.md", "rollback.md", "runbook-go-live.md", "security-review.md"]) expect(DEPLOY_DOCS, f).toContain(f)
  })

  const LATER = new Set<string>() // paths a later task will create (empty: nothing is pending)
  test("docs reference no file path that does not exist", () => {
    const top = new Set(readdirSync(ROOT))
    const missing: string[] = []
    for (const doc of DEPLOY_DOCS) {
      const text = read(`.claude/docs/deploy/${doc}`)
      const candidates = new Set<string>()
      const links = new Set<string>()
      for (const m of text.matchAll(/`([^`\s]+)`/g)) candidates.add(m[1])
      for (const m of text.matchAll(/\]\(([^)#\s]+)/g)) { candidates.add(m[1]); links.add(m[1]) }
      for (const c of candidates) {
        if (/[<>*{}$]|^https?:|^\.\.?\/|\/$/.test(c) && !/^\.\.\//.test(c)) continue
        if (links.has(c) && /^[a-z0-9-]+\.md$/.test(c) && !LATER.has(`.claude/docs/deploy/${c}`)) { if (!existsSync(resolve(ROOT, ".claude/docs/deploy", c))) missing.push(`${doc}: ${c}`); continue } // a sibling doc
        const p = c.replace(/^\.\.\/\.\.\/\.\.\//, "") // a link from .claude/docs/deploy/
        const first = p.split("/")[0]
        if (!p.includes("/") || !top.has(first) || !/\.[a-z0-9]+$/i.test(p)) continue
        if (/^\.next\/|^node_modules\/|^load\/\.users\.json$|^e2e\/\.auth\//.test(p) || LATER.has(p)) continue
        if (!existsSync(resolve(ROOT, p)) && !existsSync(resolve(ROOT, "api", p))) missing.push(`${doc}: ${p}`) // a bare `scripts/x.ts` in a doc about `npm -w api` means api/scripts/x.ts
      }
    }
    expect(missing).toEqual([])
  })

  test("the cutover doc points at the new runbooks and states the TRUST_PROXY_HOPS rule", () => {
    const t = read(".claude/docs/deploy/b6-cutover.md")
    for (const f of ["dokploy.md", "env-matrix.md", "migrations.md", "rollback.md", "runbook-go-live.md"]) expect(t, f).toContain(f)
    expect(t).toMatch(/TRUST_PROXY_HOPS[^\n]*equal[^\n]*number of (reverse )?proxies|number of (reverse )?proxies[^\n]*TRUST_PROXY_HOPS/i)
    expect(t).not.toMatch(/must overwrite `?x-forwarded-for`?/i)
  })
})

describe("restore drill script", () => {
  const dockerUp = spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0
  test("--help works and a drill without confirmation or arguments is refused (exit 4)", () => {
    const sh = resolve(ROOT, "deploy/scripts/restore-drill.sh")
    expect(spawnSync("bash", ["-n", sh]).status).toBe(0)
    expect(spawnSync("bash", [sh, "--help"], { encoding: "utf8" }).stdout).toContain("Restore drill")
    expect(spawnSync("bash", [sh, "--dump", "x"], { encoding: "utf8" }).status).toBe(4)
    expect(spawnSync("bash", [sh, "--bogus"], { encoding: "utf8" }).status).toBe(4)
  })

  test.skipIf(!dockerUp)("restore-drill.sh --self-test exits 0 against a throwaway Postgres 16 seeded with the demo data", () => {
    const r = spawnSync("bash", [resolve(ROOT, "deploy/scripts/restore-drill.sh"), "--self-test"], { encoding: "utf8", timeout: 240_000 })
    expect(r.stdout + r.stderr).toContain("SELF-TEST: PASS")
    expect(r.status).toBe(0)
  }, 250_000)
  if (!dockerUp) test("restore-drill self-test skipped: Docker is not available", () => { console.warn("SKIP: Docker is not available, the restore drill self-test did not run") })
})
