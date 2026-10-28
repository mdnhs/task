"use client"

import Link from "next/link"
import { Check, CheckCheck, Ellipsis, Link2, ListPlus, ShieldCheck, TriangleAlert } from "lucide-react"

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { When } from "@/components/when"
import type { Gates } from "../logic"
import { LINK_KIND } from "../types"
import type { Delivery, EventMessage, LinkRef, TextMessage, VoiceMessage } from "../types"
import { Transcript } from "./transcript"
import { VoicePlayer } from "./voice-player"

const DELIVERY: Record<Delivery, string> = { sent: "Sent", delivered: "Delivered", read: "Read", failed: "Not delivered" }

function Ticks({ delivery }: { delivery: Delivery }) {
  if (delivery === "failed")
    return (
      <span className="wa-tick bad">
        <TriangleAlert aria-hidden="true" />
        Not delivered
      </span>
    )
  // Both marks share one cell and crossfade (sent ✓ → delivered ✓✓); read turns them brand-coloured.
  return (
    <span className="wa-tick" data-read={delivery === "read" || undefined} role="img" aria-label={DELIVERY[delivery]} title={DELIVERY[delivery]}>
      <span className="wa-tick-ico">
        <Check aria-hidden="true" data-on={delivery === "sent" || undefined} />
        <CheckCheck aria-hidden="true" data-on={delivery !== "sent" || undefined} />
      </span>
    </span>
  )
}

export function LinkChip({ link }: { link: LinkRef }) {
  const body = (
    <>
      <span className="wa-chip-kind">{LINK_KIND[link.kind]}</span>
      <span className="wa-chip-ref">{link.ref}</span>
    </>
  )
  return link.href ? (
    <Link href={link.href} className="wa-chip" title={link.label}>{body}</Link>
  ) : (
    <span className="wa-chip" title={link.label}>{body}</span>
  )
}

// `fresh`: added while the thread is open, so it enters from the bottom (CSS .wa-in).
export function EventRow({ msg, today, tzLabel, fresh }: { msg: EventMessage; today: string; tzLabel: string; fresh?: boolean }) {
  return (
    <div className={fresh ? "wa-event wa-in" : "wa-event"}>
      <ShieldCheck aria-hidden="true" />
      <span>{msg.text}</span>
      <span className="wa-event-at"><When iso={msg.at} today={today} tzLabel={tzLabel} mode="time" /></span>
    </div>
  )
}

export function MessageRow({
  msg,
  fresh,
  g,
  today,
  tzLabel,
  onLink,
  onTask,
  onConfirm,
  onRetryTranscript,
  onResend,
}: {
  msg: TextMessage | VoiceMessage
  /** Added while the thread is open: enters from the bottom. */
  fresh?: boolean
  g: Gates
  today: string
  tzLabel: string
  onLink(): void
  onTask(): void
  onConfirm(text: string): void
  onRetryTranscript(): void
  onResend(): void
}) {
  const voiceBody = msg.kind === "voice"
  const canAct = g.link.ok || g.task.ok
  return (
    <div className={fresh ? "wa-row wa-in" : "wa-row"} data-dir={msg.dir}>
      <div className="wa-bubble-wrap">
        <div className="wa-bubble" data-voice={voiceBody || undefined}>
          {msg.kind === "text" ? (
            <p className="wa-text">{msg.text}</p>
          ) : msg.supported ? (
            <>
              <VoicePlayer id={msg.id} durationSec={msg.durationSec} />
              <Transcript
                key={msg.transcript.state}
                msg={msg}
                gate={g.confirm}
                transcribe={g.transcribe}
                today={today}
                tzLabel={tzLabel}
                onConfirm={onConfirm}
                onRetry={onRetryTranscript}
              />
            </>
          ) : (
            <div className="wa-voice-err" role="note">
              <TriangleAlert aria-hidden="true" />
              <div>
                <strong>Voice note can&apos;t be played</strong>
                <span>{msg.transcript.error}</span>
              </div>
            </div>
          )}
          <div className="wa-meta">
            {msg.dir === "out" && msg.by && <span className="wa-by">{msg.by}</span>}
            <When iso={msg.at} today={today} tzLabel={tzLabel} mode="time" />
            {msg.dir === "out" && msg.delivery && <Ticks delivery={msg.delivery} />}
          </div>
        </div>
        {canAct && msg.dir === "in" && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<button type="button" className="wa-more" aria-label="Message actions" />}>
              <Ellipsis aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={6} className="od-menu wa-menu">
              <DropdownMenuItem disabled={!g.link.ok} onClick={onLink}>
                <Link2 aria-hidden="true" />
                Link to record
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!g.task.ok} onClick={onTask}>
                <ListPlus aria-hidden="true" />
                <span className="wa-menu-txt">
                  Create task
                  {!g.task.ok && <small>{g.task.reason}</small>}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {msg.dir === "out" && msg.delivery === "failed" && g.send.ok && (
        <button type="button" className="wa-resend" onClick={onResend}>Try again</button>
      )}
      {!!msg.links?.length && (
        <div className="wa-chips" aria-label="Linked records">
          {msg.links.map((l) => <LinkChip key={`${l.kind}-${l.ref}`} link={l} />)}
        </div>
      )}
    </div>
  )
}
