import { expect, test } from "vitest"
import { KNOCK_ON_LIMIT, KnockOnTooLarge, knockOn, type PlanTask } from "./task-planning"

const t = (ref: string, dependsOn?: string[]): PlanTask => ({ ref, title: ref, start: "2026-11-20T09:00:00", due: "2026-11-20T17:00:00", status: "not_started", dependsOn })

test("knockOn pushes a dependant by whole days and keeps the wall time", () => {
  const moves = knockOn([t("a"), t("b", ["a"])], "a", { start: "2026-11-20T09:00:00", due: "2026-11-22T17:00:00" })
  expect(moves).toHaveLength(1)
  expect(moves[0].to).toEqual({ start: "2026-11-23T09:00:00", due: "2026-11-23T17:00:00" })
})

test("a push longer than the limit throws knock_on_too_large instead of silently stopping", () => {
  const chain = [t("n0"), ...Array.from({ length: KNOCK_ON_LIMIT + 5 }, (_, i) => t(`n${i + 1}`, [`n${i}`]))]
  expect(() => knockOn(chain, "n0", { start: "2026-11-20T09:00:00", due: "2026-11-25T17:00:00" })).toThrow(KnockOnTooLarge)
  const ok = chain.slice(0, 50)
  expect(knockOn(ok, "n0", { start: "2026-11-20T09:00:00", due: "2026-11-25T17:00:00" })).toHaveLength(49)
})
