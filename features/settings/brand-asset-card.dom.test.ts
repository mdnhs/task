// @vitest-environment jsdom
// Settings -> Branding: the logo and favicon cards (upload, preview, progress states, errors, replace, remove with confirm, read-only, no storage).
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn(), refresh: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push() {} }), usePathname: () => "/settings/branding", useSearchParams: () => new URLSearchParams() }))
vi.mock("@/lib/api/browser", () => ({ apiBrowser: { get: m.get, post: m.post, put: m.put, patch: vi.fn(), delete: m.del } }))

import { ApiError } from "@/lib/api/problem"
import { BrandAssetCard } from "./components/brand-asset-card"
import type { Branding } from "./types"

const ASSET = { version: "9f86d081884c7d65", mime: "image/png", width: 240, height: 64, sizeBytes: 8123 }
const EMPTY: Branding = { primaryColor: null, logo: null, favicon: null, storageReady: true }

class FakeXhr {
  static status = 200
  static lastBody: unknown = null
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  status = 200
  headers: Record<string, string> = {}
  open() {}
  setRequestHeader(k: string, v: string) { this.headers[k] = v }
  send(body: unknown) {
    FakeXhr.lastBody = body
    this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 })
    this.status = FakeXhr.status
    queueMicrotask(() => this.onload?.())
  }
}

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  ;(globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr
  // jsdom's Blob has no arrayBuffer(); every real browser does
  Blob.prototype.arrayBuffer ??= function (this: Blob) { return new Promise<ArrayBuffer>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.onerror = () => rej(r.error); r.readAsArrayBuffer(this) }) }
  URL.createObjectURL = () => "blob:preview"
  URL.revokeObjectURL = () => {}
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO
})
let root: Root | null = null
beforeEach(() => { for (const f of [m.get, m.post, m.put, m.del, m.refresh]) f.mockReset(); FakeXhr.status = 200 })
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ""
})
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)) })
async function mount(over: Partial<Parameters<typeof BrandAssetCard>[0]> = {}) {
  const onChange = vi.fn()
  const host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(BrandAssetCard, { kind: "logo", asset: null, storageReady: true, canWrite: true, orgName: "Acme Ltd", onChange, ...over })))
  return { onChange }
}
const text = () => document.body.textContent ?? ""
const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')
const bytes = (head: number[], size = 100) => { const a = new Uint8Array(size); a.set(head); return a }
const pngBytes = (w: number, h: number) => {
  const b = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 33)
  new DataView(b.buffer).setUint32(16, w)
  new DataView(b.buffer).setUint32(20, h)
  return b
}
async function choose(file: File) {
  const input = fileInput()!
  Object.defineProperty(input, "files", { value: [file], configurable: true })
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })) })
  await flush()
}
const file = (name: string, type: string, content: Uint8Array = pngBytes(240, 64)) => new File([content as BlobPart], name, { type })
const intent = { fileId: "f1", upload: { method: "PUT", url: "https://storage.example/put?sig=1", headers: { "Content-Type": "image/png", "Content-Length": "33" } } }
function happyApi(branding: Branding) {
  m.post.mockImplementation(async (path: string) => (path.endsWith("/uploads") ? intent : { fileId: "f1", status: "pending" }))
  m.get.mockResolvedValue({ fileId: "f1", status: "clean" })
  m.put.mockResolvedValue(branding)
}

describe("the logo card", () => {
  test("empty: the requirement line, an upload control, no preview image and no Remove", async () => {
    await mount()
    expect(text()).toContain("Logo")
    expect(text()).toContain("PNG, JPG or WebP · up to 1 MB")
    expect(text()).toContain("Upload logo")
    expect(document.querySelector(".set-asset-view img")).toBeNull()
    expect(text()).not.toContain("Remove")
    expect(fileInput()!.accept).not.toMatch(/svg/i)
  })

  test("with a logo: the version-pinned image, its facts, Replace and Remove", async () => {
    await mount({ asset: ASSET })
    expect(document.querySelector<HTMLImageElement>(".set-asset-view img")!.getAttribute("src")).toBe("/v1/branding/logo?v=9f86d081884c7d65")
    expect(text()).toContain("PNG · 240 × 64 · 8 KB")
    expect(text()).toContain("Replace logo")
    expect(text()).toContain("Remove")
  })

  test("a file of the wrong type, too big, or (favicon) not square is refused at once, nothing is sent", async () => {
    await mount()
    await choose(file("logo.svg", "image/svg+xml"))
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("Use a PNG, JPG or WebP image.")
    await choose(file("big.png", "image/png", new Uint8Array(1024 * 1024 + 1)))
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("Too big. The logo can be up to 1 MB.")
    expect(m.post).not.toHaveBeenCalled()
    await act(async () => root?.unmount())
    document.body.innerHTML = ""
    await mount({ kind: "favicon" })
    await choose(file("f.png", "image/png", pngBytes(64, 48)))
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("Not square. This image is 64 × 48 px.")
    expect(m.post).not.toHaveBeenCalled()
  })

  test("upload: intent, PUT to storage with the signed headers, check, scan wait, make live; the card shows Saved and the page refreshes", async () => {
    const live: Branding = { ...EMPTY, logo: ASSET }
    happyApi(live)
    const { onChange } = await mount()
    await choose(file("logo.png", "image/png"))
    expect(m.post.mock.calls[0]).toEqual(["/v1/settings/branding/{kind}/uploads", { path: { kind: "logo" }, body: { name: "logo.png", mime: "image/png", sizeBytes: 33 } }])
    expect(m.post.mock.calls[1]![0]).toBe("/v1/settings/branding/{kind}/uploads/{fileId}/complete")
    expect(m.put).toHaveBeenCalledWith("/v1/settings/branding/{kind}", { path: { kind: "logo" }, body: { fileId: "f1" } })
    expect(onChange).toHaveBeenCalledWith(live)
    expect(m.refresh).toHaveBeenCalled()
    expect(text()).toContain("Saved")
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(document.querySelector<HTMLButtonElement>(".set-drop")!.disabled).toBe(false)
  })

  test("the scan state is visible while the file is being scanned (the Replace control is locked)", async () => {
    let release: (v: unknown) => void = () => {}
    m.post.mockImplementation(async (path: string) => (path.endsWith("/uploads") ? intent : { fileId: "f1", status: "pending" }))
    m.get.mockReturnValue(new Promise((r) => { release = r }))
    await mount()
    await choose(file("logo.png", "image/png"))
    expect(text()).toContain("Scanning for viruses")
    expect(document.querySelector<HTMLButtonElement>(".set-drop")!.disabled).toBe(true)
    expect(document.querySelector(".set-asset-view img")!.getAttribute("src")).toBe("blob:preview") // the instant preview
    m.put.mockResolvedValue({ ...EMPTY, logo: ASSET })
    await act(async () => release({ fileId: "f1", status: "clean" }))
    await flush()
    expect(text()).toContain("Saved")
  })

  test.each([
    ["image_not_square", "Not square. Use a square image."],
    ["image_suspicious", "The file carries extra data. Export a clean image."],
    ["image_type_mismatch", "That is not a real PNG, JPG or WebP image."],
    ["file_infected", "Blocked. A virus was found in this file."],
  ])("the API refuses with %s: the short line is shown, the old logo stays", async (code, line) => {
    m.post.mockImplementation(async (path: string) => { if (path.endsWith("/uploads")) return intent; throw new ApiError(422, code, "r1") })
    await mount({ asset: ASSET })
    await choose(file("logo.png", "image/png"))
    expect(document.querySelector('[role="alert"]')!.textContent).toBe(line)
    expect(document.querySelector(".set-asset-view img")!.getAttribute("src")).toBe("/v1/branding/logo?v=9f86d081884c7d65")
    expect(m.refresh).not.toHaveBeenCalled()
  })

  test("an infected file found by the scan is blocked", async () => {
    m.post.mockImplementation(async (path: string) => (path.endsWith("/uploads") ? intent : { fileId: "f1", status: "pending" }))
    m.get.mockResolvedValue({ fileId: "f1", status: "infected" })
    await mount()
    await choose(file("logo.png", "image/png"))
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("Blocked. A virus was found in this file.")
    expect(m.put).not.toHaveBeenCalled()
  })

  test("a failed PUT shows one retry line", async () => {
    FakeXhr.status = 403
    m.post.mockResolvedValue(intent)
    await mount()
    await choose(file("logo.png", "image/png"))
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("The upload failed. Try again.")
  })

  test("Remove asks first; Cancel sends nothing; Remove calls DELETE and refreshes", async () => {
    m.del.mockResolvedValue({ ...EMPTY })
    const { onChange } = await mount({ asset: ASSET })
    await act(async () => document.querySelector<HTMLButtonElement>(".set-asset-rm")!.click())
    await flush()
    expect(text()).toContain("Remove the logo?")
    expect(text()).toContain("The sidebar goes back to the check mark.")
    expect(m.del).not.toHaveBeenCalled()
    await act(async () => document.querySelector<HTMLButtonElement>(".od-confirm-btn")!.click())
    await flush()
    expect(m.del).toHaveBeenCalledWith("/v1/settings/branding/{kind}", { path: { kind: "logo" } })
    expect(onChange).toHaveBeenCalledWith(EMPTY)
    expect(m.refresh).toHaveBeenCalled()
  })

  test("read-only: the logo is shown, no upload or Remove, a plain line says who can change it", async () => {
    await mount({ asset: ASSET, canWrite: false })
    expect(fileInput()).toBeNull()
    expect(document.querySelector(".set-drop")).toBeNull()
    expect(text()).not.toContain("Remove")
    expect(text()).toContain("Only an owner or admin can change this.")
    expect(document.querySelector(".set-asset-view img")).not.toBeNull()
  })

  test("no storage: a clear 'Storage is not set up' state instead of an upload control", async () => {
    await mount({ storageReady: false })
    expect(text()).toContain("Storage is not set up")
    expect(fileInput()).toBeNull()
    expect(document.querySelector(".set-drop")).toBeNull()
  })

  test("storage turns out not to be set up when the upload starts (503): the card switches to that state", async () => {
    m.post.mockRejectedValue(new ApiError(503, "storage_not_configured", "r1"))
    await mount()
    await choose(file("logo.png", "image/png"))
    expect(text()).toContain("Storage is not set up")
    expect(document.querySelector(".set-drop")).toBeNull()
  })
})

describe("the favicon card", () => {
  test("empty and with an icon: requirement, a square preview and the tab preview with the organization name", async () => {
    await mount({ kind: "favicon" })
    expect(text()).toContain("Favicon")
    expect(text()).toContain("Square PNG (32 to 512 px) or ICO · up to 256 KB")
    expect(fileInput()!.accept).toMatch(/\.ico/)
    expect(fileInput()!.accept).not.toMatch(/svg|jpe?g/i)
    await act(async () => root?.unmount())
    document.body.innerHTML = ""
    await mount({ kind: "favicon", asset: { ...ASSET, width: 64, height: 64 }, orgName: "Northgate Facilities" })
    expect(document.querySelector<HTMLImageElement>(".set-asset-view img")!.getAttribute("src")).toBe("/v1/branding/favicon?v=9f86d081884c7d65")
    expect(document.querySelector(".set-fav-tab")!.textContent).toBe("Northgate Facilities")
    expect(text()).toContain("PNG · 64 × 64 · 8 KB")
    expect(text()).toContain("Replace favicon")
  })

  test("an .ico file is accepted and sent as image/x-icon", async () => {
    happyApi({ ...EMPTY, favicon: { ...ASSET, mime: "image/x-icon", width: 32, height: 32 } })
    await mount({ kind: "favicon" })
    const ico = new Uint8Array(40)
    ico.set([0, 0, 1, 0, 1, 0, 32, 32])
    await choose(file("favicon.ico", "", ico))
    expect(m.post.mock.calls[0]![1]).toMatchObject({ body: { name: "favicon.ico", mime: "image/x-icon" } })
  })
})

describe("copy", () => {
  test("no line of the cards says Tenant", async () => {
    await mount({ asset: ASSET })
    expect(text()).not.toMatch(/tenant/i)
  })
})
