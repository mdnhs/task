"use client"

import { DetailSheet } from "@/components/detail-sheet"
import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { STAGE, STAGE_ORDER } from "../types"
import type { Candidate, Stage } from "../types"

const STAGE_OPTIONS = STAGE_ORDER.map((s) => ({ value: s, label: STAGE[s].label }))

export function CandidateSheet({
  candidate,
  open,
  onOpenChange,
  today,
  tzLabel,
  canWrite,
  onStage,
}: {
  candidate: Candidate | undefined
  open: boolean
  onOpenChange(o: boolean): void
  today: string
  tzLabel: string
  canWrite: boolean
  onStage(id: string, stage: Stage): void
}) {
  const c = candidate
  return (
    <DetailSheet open={open && !!c} onOpenChange={onOpenChange} title={c?.name ?? "Candidate"} subtitle={c && <span className="rec-sheet-sub"><StatusPill status={STAGE[c.stage]} /><span className="num">{c.id}</span></span>}>
      {c && (
        <>
          <dl className="rec-dl">
            <div>
              <dt>Stage</dt>
              <dd>
                {canWrite ? (
                  <Field label="Change stage" htmlFor="rec-stage">
                    <FilterSelect label="Stage" value={c.stage} options={STAGE_OPTIONS} onChange={(v) => onStage(c.id, v)} />
                  </Field>
                ) : (
                  <StatusPill status={STAGE[c.stage]} />
                )}
              </dd>
            </div>
            <div><dt>Role applied</dt><dd>{c.role}</dd></div>
            <div><dt>Department</dt><dd>{c.dept}</dd></div>
            <div><dt>Owner</dt><dd>{c.owner}</dd></div>
            <div><dt>Applied</dt><dd><When iso={c.applied} today={today} tzLabel={tzLabel} mode="date" /></dd></div>
            <div><dt>Last contact</dt><dd>{c.lastContact ? <When iso={c.lastContact} today={today} tzLabel={tzLabel} /> : "No contact yet"}</dd></div>
            <div><dt>Next action</dt><dd>{c.nextAction}</dd></div>
            <div>
              <dt>Contact details</dt>
              <dd>
                {c.contact ? (
                  <span className="rec-contact">
                    <a href={`mailto:${c.contact.email}`}>{c.contact.email}</a>
                    <a href={`tel:${c.contact.phone.replace(/\s/g, "")}`}>{c.contact.phone}</a>
                  </span>
                ) : (
                  <span className="rec-restricted"><Icon name="lock" /> Restricted to recruitment and management users</span>
                )}
              </dd>
            </div>
          </dl>
          <section aria-labelledby="rec-hist-h">
            <h3 id="rec-hist-h" className="rec-sub">History</h3>
            <ol className="rec-history">
              {[...c.history].reverse().map((h, n) => (
                <li key={`${h.at}-${n}`}>
                  <strong>{h.action}</strong> · {h.by}
                  <span className="rec-when"><When iso={h.at} today={today} tzLabel={tzLabel} /></span>
                  {h.note && <span className="rec-note">{h.note}</span>}
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </DetailSheet>
  )
}
