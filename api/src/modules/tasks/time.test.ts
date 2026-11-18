import { describe, expect, test } from "vitest"
import { AppError } from "../../core/errors"
import { instantOfWall, wallOf } from "./time"

const utc = (wall: string, tz: string) => instantOfWall(wall, tz).toISOString()

// Ruling S9: a wall time that does not exist (spring forward) moves to the first valid minute after the gap; one that happens twice (fall back) takes the FIRST occurrence.
describe("instantOfWall: DST gaps and folds (ruling S9)", () => {
  test("Europe/Dublin: 01:30 on 29 Mar 2026 does not exist and resolves to 02:00 local (01:00 UTC)", () => {
    expect(utc("2026-03-29T01:30:00", "Europe/Dublin")).toBe("2026-03-29T01:00:00.000Z")
    expect(wallOf(instantOfWall("2026-03-29T01:30:00", "Europe/Dublin"), "Europe/Dublin")).toBe("2026-03-29T02:00:00")
    expect(utc("2026-03-29T01:00:00", "Europe/Dublin")).toBe("2026-03-29T01:00:00.000Z") // the first minute of the gap
    expect(utc("2026-03-29T01:59:59", "Europe/Dublin")).toBe("2026-03-29T01:00:00.000Z") // the last second of the gap
    expect(utc("2026-03-29T02:00:00", "Europe/Dublin")).toBe("2026-03-29T01:00:00.000Z") // the first real one is the same instant
  })

  test("Europe/Dublin: 01:30 on 25 Oct 2026 happens twice and takes the first occurrence (00:30 UTC)", () => {
    expect(utc("2026-10-25T01:30:00", "Europe/Dublin")).toBe("2026-10-25T00:30:00.000Z")
    expect(utc("2026-10-25T01:00:00", "Europe/Dublin")).toBe("2026-10-25T00:00:00.000Z")
    expect(utc("2026-10-25T00:59:00", "Europe/Dublin")).toBe("2026-10-24T23:59:00.000Z")
    expect(utc("2026-10-25T02:00:00", "Europe/Dublin")).toBe("2026-10-25T02:00:00.000Z") // after the fold, plain GMT
  })

  test("ordinary times are untouched, seconds included", () => {
    expect(utc("2026-03-29T09:00:00", "Europe/Dublin")).toBe("2026-03-29T08:00:00.000Z")
    expect(utc("2026-11-18T09:15:42", "Europe/Dublin")).toBe("2026-11-18T09:15:42.000Z")
    expect(utc("2026-06-01T09:00", "Europe/Dublin")).toBe("2026-06-01T08:00:00.000Z")
  })

  test("America/New_York behaves the same: gap to 03:00 EDT, fold takes the EDT occurrence", () => {
    expect(utc("2026-03-08T02:30:00", "America/New_York")).toBe("2026-03-08T07:00:00.000Z")
    expect(utc("2026-11-01T01:30:00", "America/New_York")).toBe("2026-11-01T05:30:00.000Z")
  })

  test("Australia/Lord_Howe (30 minute shift) behaves the same", () => {
    // DST starts Sun 4 Oct 2026 at 02:00 (+10:30) -> 02:30 (+11:00): 02:15 does not exist, the first valid minute is 02:30
    expect(utc("2026-10-04T02:15:00", "Australia/Lord_Howe")).toBe("2026-10-03T15:30:00.000Z")
    expect(wallOf(instantOfWall("2026-10-04T02:15:00", "Australia/Lord_Howe"), "Australia/Lord_Howe")).toBe("2026-10-04T02:30:00")
    // DST ends Sun 5 Apr 2026 at 02:00 (+11:00) -> 01:30 (+10:30): 01:45 happens twice, the first one is +11:00
    expect(utc("2026-04-05T01:45:00", "Australia/Lord_Howe")).toBe("2026-04-04T14:45:00.000Z")
    expect(utc("2026-10-04T09:00:00", "Australia/Lord_Howe")).toBe("2026-10-03T22:00:00.000Z")
  })

  test("a zone without DST never has a gap or a fold", () => {
    expect(utc("2026-03-29T01:30:00", "Asia/Dhaka")).toBe("2026-03-28T19:30:00.000Z")
  })

  test("a malformed wall is a 422 invalid_dates, not a 500", () => {
    for (const w of ["2026-13-40T10:00:00", "2026-03-29", "nope"]) {
      try {
        instantOfWall(w, "Europe/Dublin")
        expect.unreachable()
      } catch (e) {
        expect(e).toBeInstanceOf(AppError)
        expect((e as AppError).status).toBe(422)
      }
    }
  })
})
