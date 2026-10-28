import { When } from "@/components/when"
import { StatusPill } from "@/components/status-pill"
import { linkedRecords } from "../logic"
import type { Conversation } from "../types"
import { LinkChip } from "./message-row"

const AUDIT_MAX = 6

// Contact, linked records and the conversation's audit trail (sends, links, task creates, confirmations).
export function ContextPanel({ conv, today, tzLabel }: { conv: Conversation; today: string; tzLabel: string }) {
  const c = conv.contact
  const links = linkedRecords(conv)
  const audit = conv.messages
    .flatMap((m) =>
      m.kind === "event" ? [{ id: m.id, at: m.at, text: m.text }] : m.dir === "out" && m.by ? [{ id: m.id, at: m.at, text: `Reply sent by ${m.by}` }] : [],
    )
    .reverse()
    .slice(0, AUDIT_MAX)
  return (
    <div className="wa-ctx-body">
      <div className="wa-ctx-contact">
        <span className={`avatar ${c.avatar}`}>{c.initials}</span>
        <div>
          <b>{c.name}</b>
          <span>{c.role}</span>
          <span className="num">{c.phone}</span>
        </div>
      </div>
      <StatusPill status={c.consent === "given" ? { tone: "ok", label: "WhatsApp consent given" } : { tone: "warn", label: "Consent not recorded" }} />

      <section aria-labelledby={`wa-links-${conv.id}`}>
        <h3 id={`wa-links-${conv.id}`} className="wa-sub">Linked records</h3>
        {links.length ? (
          <ul className="wa-ctx-links">
            {links.map((l) => (
              <li key={`${l.kind}-${l.ref}`}>
                <LinkChip link={l} />
                <span>{l.label}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="wa-ctx-empty">Nothing linked yet. Use a message&apos;s menu to link it to a user, task, client issue or report item.</p>
        )}
      </section>

      <section aria-labelledby={`wa-audit-${conv.id}`}>
        <h3 id={`wa-audit-${conv.id}`} className="wa-sub">Activity</h3>
        {audit.length ? (
          <ol className="wa-audit">
            {audit.map((a) => (
              <li key={a.id}>
                <span>{a.text}</span>
                <When iso={a.at} today={today} tzLabel={tzLabel} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="wa-ctx-empty">No replies, links or tasks yet.</p>
        )}
      </section>
    </div>
  )
}
