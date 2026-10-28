"use client"

import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Info, Mic } from "lucide-react"
import { motion } from "motion/react"
import { toast } from "sonner"

import { DetailSheet } from "@/components/detail-sheet"
import { EmptyState } from "@/components/empty-state"
import { FilterSearch, FilterSeg } from "@/components/filter-bar"
import { PageHead } from "@/components/page-head"
import { When } from "@/components/when"
import { useDept } from "@/hooks/use-dept"
import { nowInTz } from "@/lib/dates"
import { layoutTransition } from "@/lib/motion"
import { taskInbox } from "@/lib/task-inbox"
import {
  confirmTranscript,
  createTaskFromMessage,
  dayLabel,
  filterConversations,
  finishTranscript,
  gates,
  lastMessage,
  linkMessage,
  linkedRecords,
  markRead,
  messageText,
  nextTaskRef,
  preview,
  retryTranscript,
  sendMessage,
  setDelivery,
} from "../logic"
import { whatsappStore } from "../store"
import { INBOX_FILTERS } from "../types"
import type { Conversation, InboxFilter, Integration, LinkRef, LinkTargets, Message } from "../types"
import { Composer } from "./composer"
import { ContextPanel } from "./context-panel"
import { IntegrationCard } from "./integration-card"
import { LinkDialog } from "./link-dialog"
import { EventRow, MessageRow } from "./message-row"
import { TaskDialog } from "./task-dialog"
import type { NewTask } from "./task-dialog"

/** Mock provider timings (ms): a sent reply turns delivered, then read; the contact then types for a moment; a transcribing note finishes. */
const DELIVERED_AFTER = 1200
const READ_AFTER = 2600
const TYPING_FOR = 2800
const TRANSCRIBED_AFTER = 4000

type Dialog = { type: "link" | "task"; convId: string; msgId: string; n: number }

export function WhatsappView({
  conversations,
  integration,
  targets,
  today,
  tz,
  tzLabel,
  canWrite,
  canCreateTasks,
  actor,
  scopeKey,
}: {
  conversations: Conversation[]
  integration: Integration
  targets: LinkTargets
  today: string
  /** IANA timezone from the org settings; stamps new messages and events. */
  tz: string
  tzLabel: string
  canWrite: boolean
  canCreateTasks: boolean
  actor: string
  scopeKey: string
}) {
  const dept = useDept()
  const [stored, setStored] = whatsappStore.useStore(conversations, scopeKey)
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState<InboxFilter>("all")
  const [selectedId, setSelectedId] = useState<string | undefined>(conversations[0]?.id)
  // Phones show one pane at a time (list → thread drill-down); desktop ignores this.
  const [view, setView] = useState<"list" | "thread">("list")
  const [infoOpen, setInfoOpen] = useState(false)
  const [dialog, setDialog] = useState<Dialog & { open: boolean }>()
  const g = useMemo(() => gates({ canWrite, canCreateTasks, integration }), [canWrite, canCreateTasks, integration])

  const rows = useMemo(() => filterConversations(stored, { q, filter, dept }), [stored, q, filter, dept])
  const current = stored.find((c) => c.id === selectedId && rows.some((r) => r.id === c.id)) ?? rows[0]
  const unread = stored.filter((c) => dept === "all" || c.contact.dept === dept).reduce((n, c) => n + c.unread, 0)
  const createdRefs = stored.flatMap((c) => linkedRecords(c).filter((l) => l.kind === "task").map((l) => l.ref))

  // Mock transcription service: notes still transcribing finish after a delay (once per note).
  const scheduled = useRef(new Set<string>())
  useEffect(() => {
    for (const c of stored)
      for (const m of c.messages)
        if (m.kind === "voice" && m.transcript.state === "transcribing" && !scheduled.current.has(m.id)) {
          scheduled.current.add(m.id)
          window.setTimeout(() => {
            scheduled.current.delete(m.id)
            whatsappStore.set((p) => finishTranscript(p, c.id, m.id))
          }, TRANSCRIBED_AFTER)
        }
  }, [stored])

  // Mock: after a reply is read the contact is "typing" for a moment (quiet three dots in the thread). Visual only, nothing is stored.
  const [typing, setTyping] = useState<string>()
  const typingTimer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(typingTimer.current), [])
  const isTyping = !!current && typing === current.id

  // Messages added while a thread is open (index >= baseline) enter from the bottom; opening a thread doesn't replay the history.
  const count = current?.messages.length ?? 0
  const [baseline, setBaseline] = useState({ id: current?.id, n: count })
  if (baseline.id !== current?.id) setBaseline({ id: current?.id, n: count })
  const fresh = baseline.id === current?.id ? baseline.n : count

  // Keep the newest message in view: jump when the thread changes, glide when it grows (instant under reduced motion).
  const scroller = useRef<HTMLDivElement>(null)
  const shown = useRef<{ id?: string; view?: string }>({})
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const same = shown.current.id === current?.id && shown.current.view === view
    shown.current = { id: current?.id, view }
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    el.scrollTo({ top: el.scrollHeight, behavior: same && !calm ? "smooth" : "auto" })
  }, [current?.id, count, view, isTyping])

  const now = () => nowInTz(today, tz)

  function open(id: string) {
    setSelectedId(id)
    setView("thread")
    setStored((p) => markRead(p, id))
  }

  function send(text: string) {
    if (!current || !g.send.ok) return
    const id = `${current.id}-m${current.messages.length + 1}`
    setStored((p) => markRead(sendMessage(p, current.id, text, actor, now()), current.id))
    track(current.id, id)
    toast.success(`Reply sent to ${current.contact.name}`)
  }

  function resend(m: Message) {
    if (!current || !g.send.ok || m.kind === "event") return
    const convId = current.id
    setStored((p) => setDelivery(p, convId, m.id, "sent"))
    track(convId, m.id)
    toast.success("Reply sent again")
  }

  // Mock provider receipts for an outbound reply: sent ✓ → delivered ✓✓ → read (colour), then the contact types for a moment.
  function track(convId: string, msgId: string) {
    window.setTimeout(() => whatsappStore.set((p) => setDelivery(p, convId, msgId, "delivered")), DELIVERED_AFTER)
    window.setTimeout(() => {
      whatsappStore.set((p) => setDelivery(p, convId, msgId, "read"))
      setTyping(convId)
      window.clearTimeout(typingTimer.current)
      typingTimer.current = window.setTimeout(() => setTyping(undefined), TYPING_FOR)
    }, READ_AFTER)
  }

  function link(l: LinkRef) {
    if (!dialog || !g.link.ok) return
    setStored((p) => linkMessage(p, dialog.convId, dialog.msgId, l, actor, now()))
    toast.success(`Linked to ${l.ref}`)
  }

  function createTask(t: NewTask) {
    if (!dialog || !g.task.ok) return
    const ref = nextTaskRef([...targets.task.map((x) => x.ref), ...createdRefs, ...taskInbox.knownRefs(scopeKey)])
    const at = now()
    const dept = stored.find((c) => c.id === dialog.convId)?.contact.dept ?? ""
    // Hand-off to /tasks (lib/task-inbox.ts): the task shows in the tasks list, not only in this thread.
    taskInbox.push({ tenantId: scopeKey, ref, title: t.title, description: t.description, dept, assignee: t.assignee, due: t.due.slice(0, 10), creator: actor, at, source: "WhatsApp" })
    setStored((p) => createTaskFromMessage(p, dialog.convId, dialog.msgId, { ref, title: t.title }, actor, at))
    toast.success(`${ref} created`, { description: `Assigned to ${t.assignee}` })
  }

  function confirm(convId: string, msgId: string, text: string) {
    if (!g.confirm.ok) return
    setStored((p) => confirmTranscript(p, convId, msgId, text, actor, now()))
    toast.success("Transcript confirmed")
  }

  const openDialog = (type: Dialog["type"], msgId: string) =>
    current && setDialog((d) => ({ type, convId: current.id, msgId, open: true, n: (d?.n ?? 0) + 1 }))
  const dialogConv = dialog && stored.find((c) => c.id === dialog.convId)
  const dialogMsg = dialogConv?.messages.find((m) => m.id === dialog?.msgId)
  const filtered = !!q || filter !== "all" || dept !== "all"

  return (
    <>
      <PageHead title="WhatsApp" subtitle={`${rows.length} conversations · ${unread} unread`} />
      <IntegrationCard integration={integration} canWrite={canWrite} today={today} tzLabel={tzLabel} />

      <div className="wa-inbox" data-view={view}>
        <section className="card wa-list" aria-label="Conversations">
          <div className="wa-list-head">
            <FilterSearch value={q} onChange={setQ} placeholder="Search messages" />
            <FilterSeg<InboxFilter> label="Show" value={filter} options={INBOX_FILTERS} onChange={setFilter} />
          </div>
          {rows.length ? (
            // layoutScroll: the list scrolls, so motion measures reorders relative to it.
            <motion.ul className="wa-convs" layoutScroll>
              {rows.map((c) => {
                const last = lastMessage(c)
                const on = c.id === current?.id
                return (
                  // A conversation that gets a new message glides to the top instead of jumping.
                  <motion.li key={c.id} layout="position" transition={layoutTransition}>
                    <button type="button" className="wa-conv" aria-current={on || undefined} onClick={() => open(c.id)}>
                      {on && <motion.span layoutId="wa-conv-active" className="wa-conv-ind" transition={layoutTransition} />}
                      <span className={`avatar ${c.contact.avatar}`}>{c.contact.initials}</span>
                      <span className="wa-conv-main">
                        <span className="wa-conv-top">
                          <b>{c.contact.name}</b>
                          {last && <When iso={last.at} today={today} tzLabel={tzLabel} mode={last.at.slice(0, 10) === today.slice(0, 10) ? "time" : "date"} />}
                        </span>
                        <span className="wa-conv-bottom">
                          <span className="wa-conv-prev">
                            {last?.kind === "voice" && <Mic aria-hidden="true" />}
                            {preview(last)}
                          </span>
                          {c.unread > 0 && <span className="wa-unread num" aria-label={`${c.unread} unread`}>{c.unread}</span>}
                        </span>
                      </span>
                    </button>
                  </motion.li>
                )
              })}
            </motion.ul>
          ) : (
            <EmptyState
              icon="chat"
              title="No conversations match"
              text={filtered ? "Try a different search or filter." : "Inbound WhatsApp messages will appear here."}
              action={
                q || filter !== "all" ? (
                  <button type="button" className="btn btn-outline" onClick={() => { setQ(""); setFilter("all") }}>Clear filters</button>
                ) : undefined
              }
            />
          )}
        </section>

        <section className="card wa-thread" aria-label={current ? `Conversation with ${current.contact.name}` : "Conversation"}>
          {current ? (
            <>
              <header className="wa-thread-head">
                <button type="button" className="wa-icon-btn wa-back" aria-label="Back to conversations" onClick={() => setView("list")}>
                  <ArrowLeft aria-hidden="true" />
                </button>
                <span className={`avatar ${current.contact.avatar}`}>{current.contact.initials}</span>
                <div className="wa-thread-who">
                  <b>{current.contact.name}</b>
                  <span className="num">{current.contact.phone}</span>
                </div>
                <button type="button" className="wa-icon-btn wa-info-btn" aria-label="Contact and linked records" onClick={() => setInfoOpen(true)}>
                  <Info aria-hidden="true" />
                </button>
              </header>
              <div className="wa-msgs" ref={scroller} role="log" aria-label="Messages" tabIndex={0}>
                {current.messages.map((m, i) => {
                  const prev = current.messages[i - 1]
                  const newDay = !prev || prev.at.slice(0, 10) !== m.at.slice(0, 10)
                  return (
                    <Fragment key={m.id}>
                      {newDay && <div className="wa-day"><span>{dayLabel(m.at, today)}</span></div>}
                      {m.kind === "event" ? (
                        <EventRow msg={m} today={today} tzLabel={tzLabel} fresh={i >= fresh} />
                      ) : (
                        <MessageRow
                          msg={m}
                          fresh={i >= fresh}
                          g={g}
                          today={today}
                          tzLabel={tzLabel}
                          onLink={() => openDialog("link", m.id)}
                          onTask={() => openDialog("task", m.id)}
                          onConfirm={(text) => confirm(current.id, m.id, text)}
                          onRetryTranscript={() => setStored((p) => retryTranscript(p, current.id, m.id))}
                          onResend={() => resend(m)}
                        />
                      )}
                    </Fragment>
                  )
                })}
                {isTyping && (
                  <div className="wa-row wa-typing" data-dir="in">
                    <div className="wa-bubble">
                      <span className="wa-dots" aria-hidden="true"><i /><i /><i /></span>
                      <span className="sr-only">{current.contact.name} is typing</span>
                    </div>
                  </div>
                )}
              </div>
              <Composer key={current.id} gate={g.send} contact={current.contact.name} onSend={send} />
            </>
          ) : (
            <EmptyState icon="chat" title="No conversation selected" text="Pick a conversation to read it." />
          )}
        </section>

        <aside className="card wa-ctx" aria-label="Contact and linked records">
          {current && <ContextPanel conv={current} today={today} tzLabel={tzLabel} />}
        </aside>
      </div>

      <DetailSheet open={infoOpen && !!current} onOpenChange={setInfoOpen} title={current?.contact.name ?? "Contact"} subtitle={current?.contact.role}>
        {current && <ContextPanel conv={current} today={today} tzLabel={tzLabel} />}
      </DetailSheet>

      {dialog?.type === "link" && dialogMsg && dialogMsg.kind !== "event" && (
        <LinkDialog
          key={dialog.n}
          open={dialog.open}
          onOpenChange={(o) => setDialog((d) => d && { ...d, open: o })}
          targets={targets}
          linked={dialogMsg.links ?? []}
          excerpt={messageText(dialogMsg) || "Voice note"}
          onLink={link}
        />
      )}
      {dialog?.type === "task" && dialogMsg && dialogMsg.kind !== "event" && dialogConv && (
        <TaskDialog
          key={dialog.n}
          open={dialog.open}
          onOpenChange={(o) => setDialog((d) => d && { ...d, open: o })}
          text={messageText(dialogMsg)}
          source={`From WhatsApp: ${dialogConv.contact.name}, ${dayLabel(dialogMsg.at, today)}`}
          assignees={targets.user.map((u) => u.ref)}
          defaultAssignee={dialogConv.contact.userRef}
          today={today}
          onCreate={createTask}
        />
      )}
    </>
  )
}
