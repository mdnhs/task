// @vitest-environment jsdom
// B8 Task 24: "Play my day" plays a task's voice instructions only when the API says the caller can play one (`hasVoice`), through a fresh path on our origin per play (D21).
import { act, createElement } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }))
vi.mock("next/link", async () => {
  const { createElement: h } = await import("react")
  return { default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => h("a", { href, ...rest }, children) }
})

import { ME, TASK, TZ, todayDto } from "@/test/support/report-dto"
import { toToday } from "./adapters"
import { TodayCard } from "./components/today-card"

const played: string[] = []
const spoken: string[] = []
beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  class Utterance { text: string; rate = 1; onend: (() => void) | null = null; onerror: (() => void) | null = null; constructor(t: string) { this.text = t } }
  ;(globalThis as Record<string, unknown>).SpeechSynthesisUtterance = Utterance
  // the speech engine "says" each segment at once
  ;(window as unknown as { speechSynthesis: unknown }).speechSynthesis = { cancel() {}, speak(u: Utterance) { spoken.push(u.text); queueMicrotask(() => u.onend?.()) } }
  ;(globalThis as Record<string, unknown>).Audio = class { playbackRate = 1; onended: (() => void) | null = null; onerror: (() => void) | null = null; constructor(public src: string) { played.push(src) } play() { return new Promise(() => {}) } pause() {} }
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as never
  class RO { observe() {} unobserve() {} disconnect() {} }
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO
})

let root: Root | null = null
afterEach(async () => {
  await act(async () => root?.unmount())
  document.body.innerHTML = ""
  played.length = 0
  spoken.length = 0
})
const flush = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) })

const VOICED = "11111111-1111-4111-8111-111111111111"
const order = [
  { taskId: VOICED, ref: "TSK-2001", title: "Brief the night crew", priority: 3, status: "in_progress", dueAt: "2026-10-25T03:00:00.000Z", due: "2026-10-25T03:00:00", evidenceRequired: false, project: "Security", hasVoice: true, group: "overdue", reason: "overdue by 1 day" },
  // the API says false for a task whose voice the caller may not play (hidden): never a player or the lead line for it
  { taskId: TASK, ref: "TSK-1001", title: "Check fire exits", priority: 2, status: "in_progress", dueAt: "2026-10-25T09:00:00.000Z", due: "2026-10-25T09:00:00", evidenceRequired: false, project: "Security", hasVoice: false, group: "today", reason: "due today" },
]

async function playMyDay() {
  const data = toToday(todayDto({ order }), { meId: ME, tz: TZ, nowAt: "2026-10-25T08:00:00.000Z", now: "2026-10-25T08:00:00", tzLabel: "Irish time", mode: "card" })
  const host = document.createElement("div")
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root!.render(createElement(TodayCard, { data })))
  const play = [...document.querySelectorAll("button")].find((b) => /Play my day/.test(b.textContent ?? ""))!
  await act(async () => play.dispatchEvent(new MouseEvent("click", { bubbles: true })))
  await flush()
}

describe("B8 Task 24: Today voice instructions from the API's hasVoice", () => {
  test("the adapter keeps hasVoice on the item (a flag only, never a file id)", () => {
    const data = toToday(todayDto({ order }), { meId: ME, tz: TZ, nowAt: "2026-10-25T08:00:00.000Z", now: "2026-10-25T08:00:00", tzLabel: "Irish time", mode: "card" })
    expect(data.order.map((i) => i.task.hasVoice)).toEqual([true, false])
  })

  test("Today shows the audio player only when hasVoice is true and never for a hidden voice", async () => {
    await playMyDay()
    // summary, then task 1 ("Voice instructions:" lead), its recording through the API's play path, then task 2 without a lead
    expect(spoken[1]).toMatch(/Voice instructions:$/)
    expect(played).toHaveLength(1)
    expect(played[0]).toMatch(new RegExp(`^/v1/tasks/${VOICED}/voice-note\\?play=`))
    expect(document.body.textContent).toContain("Playing voice instructions")
    // move on to the second task: no recording is ever asked for it
    const next = document.querySelector<HTMLButtonElement>('button[aria-label="Next"]')!
    await act(async () => next.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await flush()
    expect(spoken.at(-1)).not.toMatch(/Voice instructions/)
    expect(played.every((u) => u.includes(VOICED))).toBe(true)
    expect(played.some((u) => u.includes(TASK))).toBe(false)
    expect(document.body.textContent).not.toMatch(/due today · voice instructions/)
  })

  test("each play is a fresh path (a new nonce), never a kept URL", async () => {
    await playMyDay()
    const repeat = document.querySelector<HTMLButtonElement>('button[aria-label="Repeat"]')!
    await act(async () => repeat.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    await flush()
    expect(played.length).toBeGreaterThanOrEqual(2)
    expect(new Set(played).size).toBe(played.length)
  })
})
