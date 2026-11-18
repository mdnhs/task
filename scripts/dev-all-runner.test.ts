import { describe, expect, test } from "vitest"
import { decide, failMessage, hashDeps } from "./dev-all-runner.mjs"

const base = { inRunner: false, useCurrent: false, mainExists: true, runnerExists: true, runnerClean: true, needsDeps: true, depsHash: "h1", stampHash: "h1", hasModules: true }

describe("dev-all runner decision", () => {
  test("recursion guard: inside the runner nothing is re-entered", () => {
    expect(decide({ ...base, inRunner: true, runnerExists: false, mainExists: false })).toEqual({ action: "run-here" })
  })
  test("DEV_ALL_USE_CURRENT runs the current checkout, even without main", () => {
    expect(decide({ ...base, useCurrent: true, mainExists: false })).toEqual({ action: "run-here" })
  })
  test("no main branch fails clearly", () => {
    expect(decide({ ...base, mainExists: false })).toEqual({ action: "fail", reason: "no-main" })
    expect(failMessage("no-main", "/r", "main")).toContain('"main" does not exist')
  })
  test("missing runner is created and installed", () => {
    expect(decide({ ...base, runnerExists: false })).toEqual({ action: "run-in-runner", create: true, install: true })
  })
  test("missing runner for down/totp is created without install", () => {
    expect(decide({ ...base, runnerExists: false, needsDeps: false })).toEqual({ action: "run-in-runner", create: true, install: false })
  })
  test("dirty runner is refused, never reset", () => {
    expect(decide({ ...base, runnerClean: false })).toEqual({ action: "fail", reason: "dirty-runner" })
    expect(failMessage("dirty-runner", "/r")).toContain("refusing")
  })
  test("clean runner with unchanged lock hash is reused without install", () => {
    expect(decide(base)).toEqual({ action: "run-in-runner", create: false, install: false })
  })
  test("changed lock hash, missing stamp or missing node_modules trigger an install", () => {
    for (const patch of [{ stampHash: "old" }, { stampHash: "" }, { hasModules: false }]) {
      expect(decide({ ...base, ...patch })).toEqual({ action: "run-in-runner", create: false, install: true })
    }
  })
  test("commands that need no dependencies never install", () => {
    expect(decide({ ...base, needsDeps: false, stampHash: "old" })).toEqual({ action: "run-in-runner", create: false, install: false })
  })
})

describe("hashDeps", () => {
  const files = (o: Record<string, string>) => (f: string) => o[f]
  test("stable for equal input, changes with any stamped file", () => {
    const a = { "package-lock.json": "1", "package.json": "2", "api/package.json": "3" }
    expect(hashDeps(files(a))).toBe(hashDeps(files({ ...a })))
    for (const k of Object.keys(a)) expect(hashDeps(files({ ...a, [k]: "x" }))).not.toBe(hashDeps(files(a)))
  })
  test("a missing file hashes like an empty one", () => {
    expect(hashDeps(() => undefined)).toBe(hashDeps(() => ""))
  })
})
