import { describe, expect, it } from "vitest"
import { canUse, describePolicy, parseDevices, parsePolicies, resolveDevice, unregisteredDevice, withholdDriveLinks, WITHHELD_DRIVE_NAME } from "./devices"
import type { Device, DevicePolicy } from "./devices"

const pc: Device = { id: "d1", userId: "u1", type: "pc", owner: "company", label: "Work PC", trusted: true, lastSeen: null }
const phone: Device = { id: "d2", userId: "u1", type: "android", owner: "personal", label: "Android phone", trusted: false, lastSeen: null }
const policy: DevicePolicy[] = [{ feature: "drive", allow: "trusted-company-pc" }]

describe("canUse", () => {
  it("allows Drive only on a trusted company PC (AC-M0-03)", () => {
    expect(canUse("drive", pc, policy)).toBe(true)
    expect(canUse("drive", phone, policy)).toBe(false)
    expect(canUse("drive", unregisteredDevice(), policy)).toBe(false)
    expect(canUse("drive", null, policy)).toBe(false)
  })
  it("denies a company PC that is not trusted, or a personal PC", () => {
    expect(canUse("drive", { ...pc, trusted: false }, policy)).toBe(false)
    expect(canUse("drive", { ...pc, owner: "personal" }, policy)).toBe(false)
  })
  it("is open without a policy and for features with allow any", () => {
    expect(canUse("drive", phone, [])).toBe(true)
    expect(canUse("whatsapp", phone, policy)).toBe(true)
    expect(canUse("drive", phone, [{ feature: "drive", allow: "any" }])).toBe(true)
  })
  it("blocks everywhere with allow none", () => {
    expect(canUse("drive", pc, [{ feature: "drive", allow: "none" }])).toBe(false)
  })
})

describe("resolveDevice", () => {
  it("returns the user's own device, else the unregistered browser", () => {
    expect(resolveDevice("d1", "u1", [pc, phone])).toBe(pc)
    expect(resolveDevice("d1", "u2", [pc, phone]).id).toBe("unregistered")
    expect(resolveDevice("nope", "u1", [pc]).id).toBe("unregistered")
    expect(resolveDevice(undefined, "u1", [pc]).trusted).toBe(false)
  })
})

describe("parseDevices / parsePolicies", () => {
  it("accepts a valid register and rejects bad input", () => {
    expect(parseDevices([pc, phone])).toEqual([pc, phone])
    expect(parseDevices("x")).toBeNull()
    expect(parseDevices([{ ...pc, type: "tablet" }])).toBeNull()
    expect(parseDevices([pc, pc])).toBeNull()
    expect(parseDevices([{ ...pc, id: "unregistered" }])).toBeNull()
    expect(parseDevices([{ ...pc, label: "x" }])).toBeNull()
  })
  it("validates policies", () => {
    expect(parsePolicies(policy)).toEqual(policy)
    expect(parsePolicies([{ feature: "drive", allow: "maybe" }])).toBeNull()
    expect(parsePolicies([policy[0], policy[0]])).toBeNull()
  })
  it("describes a policy in words", () => {
    expect(describePolicy(policy[0])).toBe("Google Drive: allowed only on trusted company PCs")
  })
})

import { isDriveUrl } from "./devices"
describe("isDriveUrl", () => {
  it("recognises Drive and Docs links only", () => {
    expect(isDriveUrl("https://drive.google.com/file/d/abc/view")).toBe(true)
    expect(isDriveUrl("https://docs.google.com/document/d/abc")).toBe(true)
    expect(isDriveUrl("https://example.com/drive.google.com/")).toBe(false)
  })
})

describe("withholdDriveLinks (FR-M1-52)", () => {
  it("removes Drive URLs from evidence and leaves the rest", () => {
    const tasks = [
      { ref: "A", evidence: [
        { kind: "drive", name: "https://drive.google.com/file/d/1/view" },
        { kind: "note", name: "see https://docs.google.com/x", url: "https://docs.google.com/x" },
        { kind: "photo", name: "gate.jpg", url: "blob:1" },
      ] },
      { ref: "B", evidence: [{ kind: "note", name: "all good" }] },
    ]
    const out = withholdDriveLinks(tasks)
    expect(out[0].evidence).toEqual([
      { kind: "drive", name: WITHHELD_DRIVE_NAME },
      { kind: "note", name: WITHHELD_DRIVE_NAME },
      { kind: "photo", name: "gate.jpg", url: "blob:1" },
    ])
    expect(out[1]).toBe(tasks[1])
    expect(JSON.stringify(out)).not.toContain("google.com")
  })
})
