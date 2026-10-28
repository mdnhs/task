import { describe, expect, it } from "vitest"
import { recordVtName } from "./record-transition"

describe("recordVtName", () => {
  it("prefixes a plain ref", () => expect(recordVtName("TSK-1042")).toBe("od-rec-TSK-1042"))
  it("replaces characters that are not valid in a custom ident", () => expect(recordVtName("A/1 2.3")).toBe("od-rec-A_1_2_3"))
  it("is unique per record", () => expect(recordVtName("TSK-1")).not.toBe(recordVtName("TSK-2")))
})
