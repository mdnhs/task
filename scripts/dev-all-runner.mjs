// Makes `npm run dev:all` run the local `main` branch from a dedicated, detached runner worktree, wherever it is invoked.
// Dependency-free Node on purpose: it runs BEFORE the invoking checkout has (or needs) node_modules.
// The decision logic (`decide`) is pure and unit-tested (scripts/dev-all-runner.test.ts); the rest shells out to git/npm.
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"

// DEV_ALL_BRANCH (default main) exists only so the runner can be tested before a change reaches main.
const BRANCH = process.env.DEV_ALL_BRANCH || "main"
const STAMPED_FILES = ["package-lock.json", "package.json", "api/package.json"]

/**
 * What to do for one invocation.
 * in: { inRunner, useCurrent, mainExists, runnerExists, runnerClean, needsDeps, depsHash, stampHash, hasModules }
 * out: { action: "run-here" } | { action: "fail", reason: "no-main" | "dirty-runner" } | { action: "run-in-runner", create, install }
 */
export function decide(i) {
  if (i.inRunner || i.useCurrent) return { action: "run-here" }
  if (!i.mainExists) return { action: "fail", reason: "no-main" }
  if (!i.runnerExists) return { action: "run-in-runner", create: true, install: i.needsDeps }
  if (!i.runnerClean) return { action: "fail", reason: "dirty-runner" }
  const stale = !i.hasModules || !i.stampHash || i.stampHash !== i.depsHash
  return { action: "run-in-runner", create: false, install: i.needsDeps && stale }
}

/** Hash of the files whose change means `npm ci` must run again. Missing files hash as empty. */
export function hashDeps(readFile) {
  const h = createHash("sha256")
  for (const f of STAMPED_FILES) h.update(`${f}\0${readFile(f) ?? ""}\0`)
  return h.digest("hex")
}

export const failMessage = (reason, runnerDir, branch = "main") =>
  reason === "no-main"
    ? `the local branch "${branch}" does not exist, so there is nothing to run. Create it or set DEV_ALL_USE_CURRENT=1 to run this checkout.`
    : `the runner checkout ${runnerDir} has local edits; refusing to touch it (nothing was discarded). Commit or discard them there (git -C ${runnerDir} status), or remove the runner (git worktree remove --force ${runnerDir}), then run again.`

// ---- impure part -------------------------------------------------------------------------------------------------------------------

const git = (cwd, args) => spawnSync("git", args, { cwd, encoding: "utf8" })
const out = (r) => (r.status === 0 ? r.stdout.trim() : "")

/** Short hash, subject and branch of what a checkout is at (for the banner). */
export function describeHead(dir) {
  return {
    hash: out(git(dir, ["rev-parse", "--short", "HEAD"])),
    subject: out(git(dir, ["log", "-1", "--format=%s"])),
    branch: out(git(dir, ["branch", "--show-current"])),
  }
}

/**
 * Called from scripts/dev-all.mjs for every command. Returns { logDir } to carry on in this process (current checkout / already in the runner),
 * or starts the same command inside the runner and returns { handedOff: true } (the process then exits with the child's code).
 */
export function enterRunner({ root, argv, die }) {
  const useCurrent = process.env.DEV_ALL_USE_CURRENT === "1"
  const here = { logDir: process.env.DEV_ALL_LOG_DIR || `${root}.local-run` }
  if (process.env.DEV_ALL_IN_RUNNER === "1" || useCurrent) return here

  const common = out(git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]))
  if (!common) die("this directory is not a git checkout, so `main` cannot be located. Set DEV_ALL_USE_CURRENT=1 to run it as it is.")
  // Stable home of the runner: beside the main checkout, in the ignored .local-run folder (DEV_ALL_RUNNER_DIR overrides, e.g. for tests).
  const runnerDir = path.resolve(process.env.DEV_ALL_RUNNER_DIR || path.join(path.dirname(common), ".local-run", "main-checkout"))
  const real = (p) => { try { return realpathSync(p) } catch { return p } }
  const inRunner = real(root).replace(/\/$/, "") === real(runnerDir) // started directly inside the runner: do not re-enter

  const cmd = argv[0] ?? "up"
  const needsDeps = cmd === "up" || cmd === "reset"
  const runnerExists = existsSync(path.join(runnerDir, ".git"))
  const stampFile = path.join(path.dirname(runnerDir), "main-checkout.deps-stamp")
  const stamp = existsSync(stampFile) ? readFileSync(stampFile, "utf8").trim() : ""
  const mainExists = git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${BRANCH}`]).status === 0

  const plan = decide({
    inRunner, useCurrent, mainExists, runnerExists, needsDeps,
    runnerClean: !runnerExists || out(git(runnerDir, ["status", "--porcelain"])) === "",
    depsHash: mainExists ? hashDeps((f) => { const r = git(root, ["show", `${BRANCH}:${f}`]); return r.status === 0 ? r.stdout : "" }) : "",
    stampHash: stamp,
    hasModules: existsSync(path.join(runnerDir, "node_modules/.bin/next")),
  })
  if (plan.action === "run-here") return here
  if (plan.action === "fail") die(failMessage(plan.reason, runnerDir, BRANCH), 2)

  if (plan.create) {
    mkdirSync(path.dirname(runnerDir), { recursive: true })
    git(root, ["worktree", "prune"]) // forget a runner whose folder was deleted by hand
    console.log(`dev-all: creating the runner checkout of main at ${runnerDir} (once) ...`)
    const r = git(root, ["worktree", "add", "--detach", runnerDir, BRANCH])
    if (r.status !== 0) die(`could not create the runner worktree: ${r.stderr.trim()}`)
  } else {
    // main only moves forward by fast-forward from other branches; a detached checkout holds no branch, so it never blocks them.
    const r = git(runnerDir, ["checkout", "--detach", "--quiet", BRANCH])
    if (r.status !== 0) die(`could not move the runner to main: ${r.stderr.trim()}`)
  }

  if (plan.install) {
    console.log("dev-all: dependencies changed (or first run): npm ci in the runner ...")
    if (spawnSync("npm", ["ci"], { cwd: runnerDir, stdio: "inherit" }).status !== 0) die("npm ci failed in the runner checkout.")
    writeFileSync(stampFile, hashDeps((f) => { try { return readFileSync(path.join(runnerDir, f), "utf8") } catch { return "" } }) + "\n")
  }

  const child = spawn(process.execPath, [path.join(runnerDir, "scripts/dev-all.mjs"), ...argv], {
    cwd: runnerDir, stdio: "inherit",
    env: { ...process.env, DEV_ALL_IN_RUNNER: "1", DEV_ALL_LOG_DIR: process.env.DEV_ALL_LOG_DIR || path.dirname(runnerDir) },
  })
  // The terminal sends Ctrl-C to the whole foreground group; forwarding also covers a signal sent to this PID only (the child's stop is idempotent).
  for (const s of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(s, () => { try { child.kill(s) } catch { /* gone */ } })
  child.on("exit", (code, sig) => process.exit(code ?? (sig ? 1 : 0)))
  return { handedOff: true }
}
