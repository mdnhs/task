import { afterEach, describe, expect, it } from "vitest"

import { VOICE_MAX_SEC, atVoiceLimit, clampVoiceSec, formatClock, pickVoiceMime, taskVoice, voiceTotal, withVoice, type VoiceEntry } from "./task-voice"
import type { TodayTask } from "./today"

const task = (ref: string): TodayTask => ({ ref, title: ref, priority: 2, due: "2026-10-30T17:00:00", status: "not_started", evidenceRequired: false, project: "Cleaning" })
const note = { url: "blob:x", durationSec: 12, mime: "audio/webm", recordedBy: "Lilianna", recordedAt: "2026-10-30T09:00:00" }
const entry = (ref: string, tenantId = "t1", assignees = ["p1"]): VoiceEntry => ({ tenantId, ref, assignees, task: task(ref), note })

describe("formatClock", () => {
  it("formats m:ss", () => {
    expect(formatClock(0)).toBe("0:00")
    expect(formatClock(7.9)).toBe("0:07")
    expect(formatClock(62)).toBe("1:02")
    expect(formatClock(120)).toBe("2:00")
  })
  it("reads bad input as 0:00", () => {
    expect(formatClock(-3)).toBe("0:00")
    expect(formatClock(Number.NaN)).toBe("0:00")
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe("0:00")
  })
})

describe("limits", () => {
  it("is 2 minutes", () => expect(VOICE_MAX_SEC).toBe(120))
  it("clamps elapsed time", () => {
    expect(clampVoiceSec(30)).toBe(30)
    expect(clampVoiceSec(130)).toBe(120)
    expect(clampVoiceSec(-1)).toBe(0)
    expect(clampVoiceSec(Number.NaN)).toBe(0)
  })
  it("knows when the limit is reached", () => {
    expect(atVoiceLimit(119.9)).toBe(false)
    expect(atVoiceLimit(120)).toBe(true)
    expect(atVoiceLimit(5, 5)).toBe(true)
  })
})

describe("pickVoiceMime", () => {
  it("takes the first type the browser records", () => {
    expect(pickVoiceMime((m) => m === "audio/mp4")).toBe("audio/mp4")
    expect(pickVoiceMime(() => true)).toBe("audio/webm;codecs=opus")
    expect(pickVoiceMime(() => false)).toBe("")
  })
})

describe("voiceTotal", () => {
  it("prefers a finite media duration, else the recorded length", () => {
    expect(voiceTotal(9.5, 10)).toBe(9.5)
    expect(voiceTotal(Number.POSITIVE_INFINITY, 10)).toBe(10)
    expect(voiceTotal(Number.NaN, 10)).toBe(10)
    expect(voiceTotal(0, 10)).toBe(10)
  })
})

describe("taskVoice + withVoice", () => {
  afterEach(() => taskVoice.reset())

  it("keeps one entry per tenant and ref", () => {
    taskVoice.put(entry("TSK-1"))
    taskVoice.put({ ...entry("TSK-1"), note: { ...note, durationSec: 30 } })
    taskVoice.put(entry("TSK-1", "t2"))
    expect(taskVoice.list("t1")).toHaveLength(1)
    expect(taskVoice.list("t1")[0].note.durationSec).toBe(30)
    expect(taskVoice.list("t2")).toHaveLength(1)
  })

  it("adds notes by ref and only the person's own new tasks", () => {
    const seed = [task("TSK-1")]
    const out = withVoice(seed, [entry("TSK-1"), entry("TSK-2"), entry("TSK-3", "t1", ["p2"])], "p1")
    expect(out.tasks.map((t) => t.ref)).toEqual(["TSK-1", "TSK-2"])
    expect(Object.keys(out.notes).sort()).toEqual(["TSK-1", "TSK-2"])
  })

  it("returns the same list when nothing is added", () => {
    const seed = [task("TSK-1")]
    expect(withVoice(seed, [], "p1").tasks).toBe(seed)
  })
})
