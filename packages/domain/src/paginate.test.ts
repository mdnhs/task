import { describe, expect, it } from "vitest"
import { pageList, paginate } from "./paginate"

const nums = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe("paginate", () => {
  it("empty input gives one empty page", () => {
    expect(paginate([], 1, 10)).toEqual({ rows: [], page: 1, pageCount: 1, from: 0, to: 0, total: 0 })
  })
  it("one page", () => {
    const r = paginate(nums(4), 1, 10)
    expect(r).toMatchObject({ rows: [1, 2, 3, 4], page: 1, pageCount: 1, from: 1, to: 4, total: 4 })
  })
  it("slices a middle page and a short last page", () => {
    expect(paginate(nums(25), 2, 10)).toMatchObject({ rows: nums(20).slice(10), pageCount: 3, from: 11, to: 20 })
    expect(paginate(nums(25), 3, 10)).toMatchObject({ rows: [21, 22, 23, 24, 25], from: 21, to: 25 })
  })
  it("clamps the page into 1..pageCount", () => {
    expect(paginate(nums(25), 99, 10).page).toBe(3)
    expect(paginate(nums(25), 0, 10).page).toBe(1)
    expect(paginate(nums(25), -4, 10).page).toBe(1)
    expect(paginate(nums(25), Number.NaN, 10).page).toBe(1)
  })
})

describe("pageList", () => {
  it("one page", () => expect(pageList(1, 1)).toEqual([1]))
  it("7 pages: first, middle, last", () => {
    expect(pageList(1, 7)).toEqual([1, 2, "ellipsis", 7])
    expect(pageList(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(pageList(7, 7)).toEqual([1, "ellipsis", 6, 7])
  })
  it("never hides just one page", () => {
    expect(pageList(3, 7)).toEqual([1, 2, 3, 4, "ellipsis", 7])
    expect(pageList(5, 7)).toEqual([1, "ellipsis", 4, 5, 6, 7])
  })
  it("20 pages: first, middle, last", () => {
    expect(pageList(1, 20)).toEqual([1, 2, "ellipsis", 20])
    expect(pageList(10, 20)).toEqual([1, "ellipsis", 9, 10, 11, "ellipsis", 20])
    expect(pageList(20, 20)).toEqual([1, "ellipsis", 19, 20])
  })
})
