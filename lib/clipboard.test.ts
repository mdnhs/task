import { describe, expect, it, vi } from "vitest"

import { copyText } from "./clipboard"

// A tiny DOM stand-in: enough for the textarea + execCommand fallback.
function fakeDoc(execResult: boolean | "throw") {
  const el = { value: "", style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn(), remove: vi.fn() }
  const doc = {
    createElement: vi.fn(() => el),
    body: { appendChild: vi.fn() },
    execCommand: vi.fn(() => {
      if (execResult === "throw") throw new Error("nope")
      return execResult
    }),
  }
  return { doc, el }
}

describe("copyText", () => {
  it("uses the async clipboard when it works", async () => {
    const writeText = vi.fn(() => Promise.resolve())
    const { doc } = fakeDoc(true)
    await expect(copyText("t1", { clipboard: { writeText } }, doc)).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith("t1")
    expect(doc.execCommand).not.toHaveBeenCalled()
  })
  it("falls back to a hidden textarea when the clipboard API is missing", async () => {
    const { doc, el } = fakeDoc(true)
    await expect(copyText("OD-1001", {}, doc)).resolves.toBe(true)
    expect(el.value).toBe("OD-1001")
    expect(el.select).toHaveBeenCalled()
    expect(doc.execCommand).toHaveBeenCalledWith("copy")
    expect(el.remove).toHaveBeenCalled()
  })
  it("falls back when the clipboard API rejects (no permission, insecure origin)", async () => {
    const { doc } = fakeDoc(true)
    await expect(copyText("x", { clipboard: { writeText: () => Promise.reject(new Error("denied")) } }, doc)).resolves.toBe(true)
    expect(doc.execCommand).toHaveBeenCalled()
  })
  it("reports failure when both ways fail", async () => {
    const { doc, el } = fakeDoc("throw")
    await expect(copyText("x", {}, doc)).resolves.toBe(false)
    expect(el.remove).toHaveBeenCalled()
    await expect(copyText("x", {}, fakeDoc(false).doc)).resolves.toBe(false)
    await expect(copyText("x", {}, null)).resolves.toBe(false)
  })
})
