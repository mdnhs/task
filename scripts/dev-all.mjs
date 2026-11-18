// One-command local runner: the whole stack (Postgres, Redis, MinIO, API, worker, web) for looking at the app in a browser.
//   npm run dev:all          start (idempotent: a second run keeps the data and only seeds an EMPTY database)
//   npm run dev:all:down     remove the containers AND volumes
//   npm run dev:all:reset    down, then start with a fresh database and the demo seed
//   npm run dev:all:totp     print the current 6-digit code of the seeded platform operator
// Everything is local and fake: demo data, throwaway credentials, no live provider. It reuses docker-compose.local.yml and the e2e preparation
// (api/scripts/e2e-prepare.ts: roles.sql, migrations as app_owner, MinIO bucket) and the demo seed (api/scripts/seed-demo.ts, same env as e2e/stack-env.ts).
// It never reads or writes a .env file and refuses to run if a DATABASE_URL-like variable of the shell points anywhere but localhost.
// Ports are overridable: LOCAL_WEB_PORT, LOCAL_API_PORT, LOCAL_PG_PORT, LOCAL_REDIS_PORT, LOCAL_MINIO_PORT. LOCAL_CLAMAV=1 adds ClamAV (heavy, amd64).
import { spawn, spawnSync } from "node:child_process"
import { createHmac } from "node:crypto"
import { mkdirSync, openSync, existsSync } from "node:fs"
import net from "node:net"
import { fileURLToPath } from "node:url"
import pg from "pg"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const API_DIR = `${ROOT}api`
const LOG_DIR = `${ROOT}.local-run`
const COMPOSE = ["docker", "compose", "-p", "opsdesk-local", "-f", `${ROOT}docker-compose.local.yml`]

const port = (name, def) => {
  const v = Number(process.env[name] ?? def)
  if (!Number.isInteger(v) || v < 1 || v > 65535) die(`${name} must be a port number`)
  return v
}
function die(msg, code = 1) {
  console.error(`\ndev-all: ${msg}`)
  process.exit(code)
}

const WEB_PORT = port("LOCAL_WEB_PORT", 3200)
const API_PORT = port("LOCAL_API_PORT", 3201)
const PG_PORT = port("LOCAL_PG_PORT", 54330)
const REDIS_PORT = port("LOCAL_REDIS_PORT", 63790)
const MINIO_PORT = port("LOCAL_MINIO_PORT", 59100)
const CLAMAV_PORT = port("LOCAL_CLAMAV_PORT", 53311)
const CLAMAV = process.env.LOCAL_CLAMAV === "1"
const WEB = `http://localhost:${WEB_PORT}`
const API = `http://localhost:${API_PORT}`

// Fixed, documented, throwaway values (a demo only; never use them anywhere real).
const DEMO_PASSWORD = "opsdesk-local-demo-1"
const PLATFORM_EMAIL = "platform.owner@demo.example"
const PLATFORM_TOTP = "localplatformtotpsecret0123456789"
const DB = "opsdesk_local"
const PG_ADMIN = `postgres://postgres:postgres@localhost:${PG_PORT}/${DB}`
const OWNER_URL = `postgres://app_owner:local_owner_pw@localhost:${PG_PORT}/${DB}`
const USER_URL = `postgres://app_user:local_user_pw@localhost:${PG_PORT}/${DB}`
const S3 = { endpoint: `http://localhost:${MINIO_PORT}`, bucket: "opsdesk-local", key: "localminio", secret: "localminio-secret" }

/** RFC 6238 (SHA-1, 6 digits, 30 s) over the raw key the seed enrolled, same as e2e/totp.ts. */
function totp(rawKey, at = Date.now()) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const h = createHmac("sha1", Buffer.from(rawKey)).update(counter).digest()
  const o = h[h.length - 1] & 0xf
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0")
}

// 1. Safety: nothing in the shell may point at a non-local service (the children get a clean env anyway, but fail loudly rather than silently ignore it).
function assertLocalEnv() {
  const keys = ["DATABASE_URL", "DATABASE_OWNER_URL", "REDIS_URL", "API_URL", "APP_URL", "APP_ORIGIN", "S3_ENDPOINT", "E2E_PG_ADMIN_URL", "SMOKE_BASE"]
  for (const k of keys) {
    const v = process.env[k]
    if (!v) continue
    let host = ""
    try { host = new URL(v).hostname } catch { /* not a URL: treated as non-local below */ }
    if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) die(`refused: ${k} in your shell points to a non-local host. Unset it (this runner only talks to localhost).`, 2)
  }
}

// Child processes get a minimal environment: no developer credentials (Stripe, Resend, Google, R2, ...) can leak into the demo.
const PASS = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "XDG_CONFIG_HOME", "SSL_CERT_FILE", "COLORTERM"]
const baseEnv = () => Object.fromEntries(PASS.filter((k) => process.env[k] !== undefined).map((k) => [k, process.env[k]]))
const composeEnv = () => ({
  ...baseEnv(),
  LOCAL_PG_PORT: String(PG_PORT), LOCAL_REDIS_PORT: String(REDIS_PORT), LOCAL_MINIO_PORT: String(MINIO_PORT), LOCAL_CLAMAV_PORT: String(CLAMAV_PORT), LOCAL_WEB_PORT: String(WEB_PORT),
})

const apiEnv = () => ({
  ...baseEnv(),
  NODE_ENV: "development", // plain http on localhost: the API names its device cookie `od-device-*`
  PORT: String(API_PORT),
  DATABASE_URL: USER_URL,
  DATABASE_OWNER_URL: OWNER_URL,
  REDIS_URL: `redis://localhost:${REDIS_PORT}`,
  BETTER_AUTH_SECRET: "local-run-auth-secret-0123456789abcdefghij",
  APP_URL: WEB,
  DATA_REGION: "eu-west-1",
  SECRETS_KEY: Buffer.alloc(32, 7).toString("base64"),
  S3_ENDPOINT: S3.endpoint, S3_REGION: "eu-west-1", S3_BUCKET: S3.bucket, S3_ACCESS_KEY_ID: S3.key, S3_SECRET_ACCESS_KEY: S3.secret, S3_FORCE_PATH_STYLE: "true",
  ...(CLAMAV ? { CLAMD_HOST: "localhost", CLAMD_PORT: String(CLAMAV_PORT) } : {}),
  AUTH_RATE_LIMIT_PER_MIN: "1000",
  RESEND_API_KEY: "", STRIPE_SECRET_KEY: "", STRIPE_WEBHOOK_SECRET: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "",
  ALLOW_DEMO_SEED: "1",
  SEED_DEMO_PASSWORD: DEMO_PASSWORD,
  SEED_PLATFORM_TOTP_SECRET: PLATFORM_TOTP,
  E2E_PG_ADMIN_URL: PG_ADMIN, E2E_OWNER_PW: "local_owner_pw", E2E_USER_PW: "local_user_pw", // read by api/scripts/e2e-prepare.ts
})
const webEnv = () => ({ ...baseEnv(), API_URL: API, APP_ORIGIN: WEB, ENABLE_MOCK_MODULES: "1", NEXT_TELEMETRY_DISABLED: "1" })

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8", ...opts })
}
function dockerOrDie() {
  if (run("docker", ["info"], { quiet: true }).status !== 0) die("Docker is not running (or not installed). Start Docker Desktop and try again.")
}
function compose(args, opts = {}) {
  return run(COMPOSE[0], [...COMPOSE.slice(1), ...(CLAMAV ? ["--profile", "scan"] : []), ...args], { env: composeEnv(), ...opts })
}

const portFree = (p) => new Promise((res) => {
  const s = net.createServer()
  s.once("error", () => res(false))
  s.once("listening", () => s.close(() => res(true)))
  s.listen(p, "127.0.0.1")
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitFor(url, label, ms, alive = () => true) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (!alive()) die(`${label} stopped while starting; see ${LOG_DIR}`)
    try {
      const r = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5000) })
      if (r.status === 200) return
    } catch { /* not up yet */ }
    await sleep(1000)
  }
  die(`${label} did not answer ${url} in time; see ${LOG_DIR}`)
}

// ---- commands ----------------------------------------------------------------------------------------------------------------------

function down() {
  dockerOrDie()
  // Remove the optional ClamAV too, whichever way it was started.
  const r = run(COMPOSE[0], [...COMPOSE.slice(1), "--profile", "scan", "down", "-v", "--remove-orphans"], { env: composeEnv() })
  if (r.status !== 0) die("docker compose down failed")
  console.log("dev-all: containers and volumes removed (project opsdesk-local).")
}

async function start() {
  assertLocalEnv()
  dockerOrDie()
  if (!existsSync(`${ROOT}node_modules/.bin/next`)) die("dependencies are not installed: run `npm ci` first.")
  mkdirSync(LOG_DIR, { recursive: true })

  // Ports: ours must be free. The containers' own ports are skipped when our project already runs (a second `npm run dev:all`).
  const running = compose(["ps", "-q"], { quiet: true }).stdout?.trim()
  const need = [["web", WEB_PORT, "LOCAL_WEB_PORT"], ["api", API_PORT, "LOCAL_API_PORT"]]
  if (!running) need.push(["postgres", PG_PORT, "LOCAL_PG_PORT"], ["redis", REDIS_PORT, "LOCAL_REDIS_PORT"], ["minio", MINIO_PORT, "LOCAL_MINIO_PORT"])
  for (const [name, p, envName] of need) if (!(await portFree(p))) die(`port ${p} (${name}) is already in use. Stop whatever uses it (lsof -nP -iTCP:${p} -sTCP:LISTEN) or set ${envName}=<free port>.`)

  console.log("dev-all: starting Postgres, Redis, MinIO" + (CLAMAV ? ", ClamAV (slow)" : "") + " ...")
  if (compose(["up", "-d", "--wait"]).status !== 0) die("docker compose up failed (a port clash or a failed healthcheck; see `docker compose -p opsdesk-local logs`).")

  const tsx = `${ROOT}node_modules/.bin/tsx`
  console.log("dev-all: roles, migrations (as app_owner) and MinIO bucket ...")
  if (run(tsx, ["scripts/e2e-prepare.ts"], { cwd: API_DIR, env: apiEnv(), quiet: true }).status !== 0) {
    const r = run(tsx, ["scripts/e2e-prepare.ts"], { cwd: API_DIR, env: apiEnv() })
    die(`database preparation failed (exit ${r.status}).`)
  }

  const su = new pg.Client({ connectionString: PG_ADMIN })
  await su.connect()
  const empty = Number((await su.query("select count(*)::int as n from tenants")).rows[0].n) === 0
  await su.end()
  if (empty) {
    console.log("dev-all: empty database, loading the demo seed (about a minute) ...")
    const r = run(tsx, ["scripts/seed-demo.ts"], { cwd: API_DIR, env: apiEnv(), quiet: true })
    if (r.status !== 0) die(`demo seed failed:\n${r.stdout}\n${r.stderr}\nRun \`npm run dev:all:reset\` to start clean.`)
  } else console.log("dev-all: database already has data, seed skipped (npm run dev:all:reset wipes it).")

  // The three app processes, each in its own process group so Ctrl-C stops the whole tree.
  const kids = []
  let stopping = false
  const launch = (name, cmd, args, cwd, env) => {
    const log = openSync(`${LOG_DIR}/${name}.log`, "w")
    const k = { name, exited: false }
    const go = () => {
      k.child = spawn(cmd, args, { cwd, env, detached: true, stdio: ["ignore", log, log] })
      k.child.on("exit", (code) => {
        k.exited = true
        if (!stopping) k.onExit?.(code)
      })
    }
    k.go = go
    go()
    kids.push(k)
    return k
  }
  const stopAll = async (code = 0) => {
    if (stopping) return
    stopping = true
    console.log("\ndev-all: stopping the web, worker and API (Docker data is kept; `npm run dev:all:down` removes it) ...")
    for (const k of kids) if (!k.exited) try { process.kill(-k.child.pid, "SIGTERM") } catch { /* gone */ }
    const end = Date.now() + 8000
    while (Date.now() < end && kids.some((k) => !k.exited)) await sleep(200)
    for (const k of kids) if (!k.exited) try { process.kill(-k.child.pid, "SIGKILL") } catch { /* gone */ }
    process.exit(code)
  }
  process.on("SIGINT", () => stopAll(0))
  process.on("SIGTERM", () => stopAll(0))
  process.on("SIGHUP", () => stopAll(0))

  const api = launch("api", tsx, ["src/server.ts"], API_DIR, apiEnv())
  const worker = launch("worker", tsx, ["src/worker.ts"], API_DIR, apiEnv())
  const web = launch("web", `${ROOT}node_modules/.bin/next`, ["dev", "-p", String(WEB_PORT)], ROOT, webEnv())
  // Next's one-off "upgrade recommendation" stop on a fresh machine exits early: start it a second time, as playwright.config.ts does.
  let webRetried = false
  web.onExit = (c) => { if (!webRetried && !ready) { webRetried = true; web.exited = false; web.go() } else stopAll(c ?? 1) }
  api.onExit = (c) => { console.error(`dev-all: the API exited (${c}); see ${LOG_DIR}/api.log`); stopAll(1) }
  worker.onExit = (c) => { console.error(`dev-all: the worker exited (${c}); see ${LOG_DIR}/worker.log`); stopAll(1) }
  let ready = false

  await waitFor(`${API}/readyz`, "the API (/readyz)", 90_000, () => !api.exited)
  await waitFor(`${WEB}/sign-in`, "the web (/sign-in; the first compile takes a while)", 360_000, () => !web.exited || !webRetried)
  ready = true

  console.log(`
==================================================================================================
  OpsDesk is running locally (demo data, nothing leaves this machine)

  Web        ${WEB}/sign-in
  API        ${API}/readyz        (logs: ${LOG_DIR}/{api,worker,web}.log)
  MinIO      ${S3.endpoint}   Postgres  localhost:${PG_PORT}   Redis  localhost:${REDIS_PORT}

  Demo password for every account:  ${DEMO_PASSWORD}

  Owner (all scope)        amara.bello@demo.example
  Manager (all scope)      lilianna.novak@demo.example
  Manager (Security team)  daniel.okafor@demo.example
  Employee (Cleaning)      tomasz.wojcik@demo.example
  Platform operator        ${PLATFORM_EMAIL}  (then the console at ${WEB}/platform)
    needs a 6-digit code:  npm run dev:all:totp      (secret: ${PLATFORM_TOTP})

  Mock modules are visible (ENABLE_MOCK_MODULES=1)${CLAMAV ? "" : ". ClamAV is off: uploaded files stay pending (LOCAL_CLAMAV=1 turns it on)"}.
  Stop: Ctrl-C here (data kept).  Remove everything: npm run dev:all:down.  Fresh data: npm run dev:all:reset
==================================================================================================
`)
  await new Promise(() => {}) // run until a signal or a child exit
}

const cmd = process.argv[2] ?? "up"
if (cmd === "totp") console.log(totp(PLATFORM_TOTP))
else if (cmd === "down") down()
else if (cmd === "reset") { down(); await start() }
else if (cmd === "up") await start()
else die(`unknown command "${cmd}" (use: up | down | reset | totp)`, 2)
