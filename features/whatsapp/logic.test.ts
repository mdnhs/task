import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

import {
  confirmTranscript,
  createTaskFromMessage,
  filterConversations,
  finishTranscript,
  gates,
  linkMessage,
  linkedRecords,
  markRead,
  nextTaskRef,
  retryTranscript,
  sendMessage,
  setDelivery,
  waveform,
} from "./logic"
import { can, canWriteFor, moduleForHref } from "@/lib/permissions"
import { createStore } from "@/lib/store"
import type { Role } from "@/lib/types"
import type { Conversation, FlowId, Integration, VoiceMessage } from "./types"

const AT = "2026-10-20T09:00:00"
const ME = "Lilianna Novak"

const voiceMsg = (over: Partial<VoiceMessage["transcript"]> = {}): VoiceMessage => ({
  id: "c1-m2",
  kind: "voice",
  dir: "in",
  at: "2026-10-20T08:10:00",
  durationSec: 14,
  format: "ogg",
  supported: true,
  transcript: { state: "ready", text: "Door on level two won't latch", confidence: 0.9, ...over },
})
const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: "c1",
  unread: 2,
  contact: { name: "Daniel Okafor", phone: "+44 7700 900123", initials: "DO", avatar: "av1", role: "Security Officer", dept: "Security", consent: "given" },
  messages: [{ id: "c1-m1", kind: "text", dir: "in", at: "2026-10-20T08:00:00", text: "Fire door stuck" }, voiceMsg()],
  ...over,
})
const integ = (over: Partial<Integration> = {}, off: FlowId[] = []): Integration => ({
  provider: "P",
  method: "API",
  businessNumber: "+44 20 0000 0000",
  status: "pending",
  note: "",
  flows: (["alerts", "inbound", "outbound", "task_creation", "voice"] as FlowId[]).map((id) => ({ id, label: id, description: "", state: off.includes(id) ? "pending" : "enabled" })),
  privacy: { audioRetentionDays: 30, transcriptRetentionDays: 90, storage: "", transcription: "", consent: "" },
  ...over,
})

describe("store actions through createStore", () => {
  it("send, link, create task and confirm all go through one store and leave an audit trail", () => {
    const s = createStore<Conversation[]>()
    s.seed([conv()])
    s.set((p) => sendMessage(p, "c1", "  On my way  ", ME, AT))
    s.set((p) => linkMessage(p, "c1", "c1-m1", { kind: "task", ref: "TSK-1004", label: "Carpet" }, ME, AT))
    s.set((p) => createTaskFromMessage(p, "c1", "c1-m2", { ref: "TSK-1043", title: "Fix door" }, ME, AT))
    s.set((p) => confirmTranscript(p, "c1", "c1-m2", "Door on level two won't latch", ME, AT))
    const c = s.get()![0]
    expect(c.messages.map((m) => m.kind)).toEqual(["text", "voice", "text", "event", "event", "event"])
    expect(c.messages.filter((m) => m.kind === "event").map((m) => m.kind === "event" && m.text)).toEqual([
      "Linked to TSK-1004 by Lilianna Novak",
      "Task TSK-1043 created from this message by Lilianna Novak",
      "Transcript confirmed by Lilianna Novak",
    ])
  })
})

describe("sendMessage", () => {
  it("appends a trimmed outbound message, stamped with sender and sent tick", () => {
    const [c] = sendMessage([conv()], "c1", "  On my way ", ME, AT)
    expect(c.messages.at(-1)).toEqual({ id: "c1-m3", kind: "text", dir: "out", text: "On my way", by: ME, at: AT, delivery: "sent" })
  })
  it("ignores blank text", () => {
    const list = [conv()]
    expect(sendMessage(list, "c1", "   ", ME, AT)).toBe(list)
  })
  it("delivery ticks update only outbound messages", () => {
    const sent = sendMessage([conv()], "c1", "Hi", ME, AT)
    const [c] = setDelivery(setDelivery(sent, "c1", "c1-m3", "delivered"), "c1", "c1-m1", "read")
    expect(c.messages[2]).toMatchObject({ delivery: "delivered" })
    expect(c.messages[0]).not.toHaveProperty("delivery")
  })
})

describe("linkMessage", () => {
  const link = { kind: "issue" as const, ref: "CI-208", label: "Reception spill" }
  it("adds the chip and an auditable event", () => {
    const [c] = linkMessage([conv()], "c1", "c1-m1", link, ME, AT)
    expect(c.messages[0]).toMatchObject({ links: [link] })
    expect(c.messages.at(-1)).toEqual({ id: "c1-m3", kind: "event", at: AT, by: ME, text: "Linked to CI-208 by Lilianna Novak" })
    expect(linkedRecords(c)).toEqual([link])
  })
  it("is a no-op for the same record twice or an unknown message", () => {
    const once = linkMessage([conv()], "c1", "c1-m1", link, ME, AT)
    expect(linkMessage(once, "c1", "c1-m1", link, ME, AT)[0]).toBe(once[0])
    const list = [conv()]
    expect(linkMessage(list, "c1", "nope", link, ME, AT)[0]).toBe(list[0])
  })
})

describe("createTaskFromMessage", () => {
  it("links the new task to the message and records who created it", () => {
    const [c] = createTaskFromMessage([conv()], "c1", "c1-m1", { ref: "TSK-1043", title: "Fix fire door" }, ME, AT)
    expect(c.messages[0]).toMatchObject({ links: [{ kind: "task", ref: "TSK-1043", label: "Fix fire door" }] })
    expect(c.messages.at(-1)).toMatchObject({ kind: "event", text: "Task TSK-1043 created from this message by Lilianna Novak" })
  })
  it("next task ref never collides", () => expect(nextTaskRef(["TSK-1012", "TSK-1042"])).toBe("TSK-1043"))
})

describe("confirmTranscript", () => {
  it("confirms unchanged text without the edited flag", () => {
    const [c] = confirmTranscript([conv()], "c1", "c1-m2", "Door on level two won't latch", ME, AT)
    expect((c.messages[1] as VoiceMessage).transcript).toMatchObject({ confirmedBy: ME, confirmedAt: AT, edited: false })
    expect(c.messages.at(-1)).toMatchObject({ text: "Transcript confirmed by Lilianna Novak" })
  })
  it("edit + confirm keeps the new text and says it was edited", () => {
    const [c] = confirmTranscript([conv()], "c1", "c1-m2", "Door on level 2 won't latch", ME, AT)
    expect((c.messages[1] as VoiceMessage).transcript).toMatchObject({ text: "Door on level 2 won't latch", edited: true })
    expect(c.messages.at(-1)).toMatchObject({ text: "Transcript edited and confirmed by Lilianna Novak" })
  })
  it("can't confirm twice or confirm a transcript that isn't ready", () => {
    const once = confirmTranscript([conv()], "c1", "c1-m2", "x", ME, AT)
    expect(confirmTranscript(once, "c1", "c1-m2", "y", ME, AT)[0]).toBe(once[0])
    const failed = [conv({ messages: [voiceMsg({ state: "failed", text: undefined })] })]
    expect(confirmTranscript(failed, "c1", "c1-m2", "y", ME, AT)[0]).toBe(failed[0])
  })
})

describe("transcription states", () => {
  it("retry → transcribing → ready with the service result", () => {
    const failed = [conv({ messages: [voiceMsg({ state: "failed", text: undefined, error: "x", result: { text: "Need blue roll", confidence: 0.6 } })] })]
    const retrying = retryTranscript(failed, "c1", "c1-m2")
    expect((retrying[0].messages[0] as VoiceMessage).transcript.state).toBe("transcribing")
    const done = (finishTranscript(retrying, "c1", "c1-m2")[0].messages[0] as VoiceMessage).transcript
    expect(done).toMatchObject({ state: "ready", text: "Need blue roll", confidence: 0.6 })
  })
  it("fails gracefully when the service returns nothing", () => {
    const t = [conv({ messages: [voiceMsg({ state: "transcribing", text: undefined })] })]
    expect((finishTranscript(t, "c1", "c1-m2")[0].messages[0] as VoiceMessage).transcript.state).toBe("failed")
  })
})

describe("gates (permission gating, FR-WA-04)", () => {
  it("writer on a confirmed flow can do everything", () => {
    const g = gates({ canWrite: true, canCreateTasks: true, integration: integ() })
    expect(Object.values(g).every((x) => x.ok)).toBe(true)
  })
  it("read-only roles can't send, link, create tasks or confirm, and get a reason", () => {
    const g = gates({ canWrite: false, canCreateTasks: true, integration: integ() })
    for (const k of ["send", "link", "task", "confirm"] as const) {
      expect(g[k].ok).toBe(false)
      expect(!g[k].ok && g[k].reason).toMatch(/read-only/)
    }
  })
  it("disconnected integration blocks sending only", () => {
    const g = gates({ canWrite: true, canCreateTasks: true, integration: integ({ status: "disconnected" }) })
    expect(g.send.ok).toBe(false)
    expect(g.link.ok && g.task.ok).toBe(true)
  })
  it("flows the client hasn't confirmed stay off", () => {
    const g = gates({ canWrite: true, canCreateTasks: true, integration: integ({}, ["outbound", "task_creation", "voice"]) })
    expect([g.send.ok, g.task.ok, g.confirm.ok, g.transcribe.ok]).toEqual([false, false, false, false])
  })
  it("task creation also needs write access to Tasks", () => {
    const g = gates({ canWrite: true, canCreateTasks: false, integration: integ() })
    expect(!g.task.ok && g.task.reason).toMatch(/Tasks/)
  })
})

describe("filterConversations / markRead", () => {
  const voiceless = conv({ id: "c2", unread: 0, contact: { ...conv().contact, name: "Grace Mensah", dept: "Cleaning" }, messages: [{ id: "c2-m1", kind: "text", dir: "in", at: AT, text: "Running late" }] })
  const linked = linkMessage([conv()], "c1", "c1-m1", { kind: "task", ref: "TSK-1", label: "t" }, ME, AT)[0]
  const list = [linked, voiceless]
  const ids = (f: Parameters<typeof filterConversations>[1]) => filterConversations(list, f).map((c) => c.id)
  it("filters", () => {
    expect(ids({ q: "", filter: "unread", dept: "all" })).toEqual(["c1"])
    expect(ids({ q: "", filter: "linked", dept: "all" })).toEqual(["c1"])
    expect(ids({ q: "", filter: "unlinked", dept: "all" })).toEqual(["c2"])
    expect(ids({ q: "", filter: "voice", dept: "all" })).toEqual(["c1"])
    expect(ids({ q: "", filter: "all", dept: "Cleaning" })).toEqual(["c2"])
  })
  it("searches names and transcripts", () => {
    expect(ids({ q: "latch", filter: "all", dept: "all" })).toEqual(["c1"])
    expect(ids({ q: "grace", filter: "all", dept: "all" })).toEqual(["c2"])
  })
  it("markRead clears unread", () => expect(markRead(list, "c1")[0].unread).toBe(0))
  it("waveform is deterministic", () => expect(waveform("a")).toEqual(waveform("a")))
})

describe("module wiring", () => {
  const { roles } = JSON.parse(readFileSync(path.join(process.cwd(), "public/data/shell/roles.json"), "utf-8")) as { roles: Role[] }
  const role = (id: string) => roles.find((r) => r.id === id)!
  it("routes /whatsapp to its module", () => expect(moduleForHref("/whatsapp")).toBe("whatsapp"))
  it("every role has a WhatsApp access level", () => expect(roles.every((r) => ["none", "read", "write"].includes(r.access.whatsapp))).toBe(true))
  it("managers write, auditors read, employees and the platform admin can't open it", () => {
    expect(can(role("manager"), "whatsapp", "write")).toBe(true)
    expect(can(role("auditor"), "whatsapp")).toBe(true)
    expect(can(role("auditor"), "whatsapp", "write")).toBe(false)
    expect(can(role("employee"), "whatsapp")).toBe(false)
    expect(can(role("platform"), "whatsapp")).toBe(false)
  })
  it("a suspended tenant is read-only here too", () => expect(canWriteFor(role("owner"), "suspended", "whatsapp")).toBe(false))
})
