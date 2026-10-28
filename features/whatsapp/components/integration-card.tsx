"use client"

import { Lock, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { Icon } from "@/components/icons"
import { StatusPill } from "@/components/status-pill"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { When } from "@/components/when"
import { FLOW_STATE, INTEGRATION_STATUS } from "../types"
import type { Integration } from "../types"

// Integration status (FR-WA-01/06/07/08, OC-05): provider, number, which flows the client has confirmed, failures and the privacy rules.
// Collapsed by default: the head (title, note, status) is the trigger; a failure alert stays visible outside the panel.
export function IntegrationCard({ integration: i, canWrite, today, tzLabel }: { integration: Integration; canWrite: boolean; today: string; tzLabel: string }) {
  return (
    <section className="card wa-integ" aria-label="WhatsApp integration">
      <Accordion>
        <AccordionItem value="integration" className="wa-integ-item">
          <AccordionTrigger className="wa-integ-head">
            <span className="wa-integ-ico" aria-hidden="true"><Icon name="chat" /></span>
            <span className="wa-integ-title">
              <span className="wa-integ-h">WhatsApp integration</span>
              <span className="wa-integ-note">{i.note}</span>
            </span>
            <StatusPill status={INTEGRATION_STATUS[i.status]} />
          </AccordionTrigger>
          <AccordionContent className="wa-integ-body" keepMounted>
            <dl className="wa-integ-meta">
              <div><dt>Provider</dt><dd>{i.provider ?? "Not chosen yet"}</dd></div>
              <div><dt>Method</dt><dd>{i.method}</dd></div>
              <div><dt>Business number</dt><dd className="num">{i.businessNumber ?? "Not confirmed"}</dd></div>
              <div><dt>Last sync</dt><dd>{i.lastSyncAt ? <When iso={i.lastSyncAt} today={today} tzLabel={tzLabel} /> : "Never"}</dd></div>
            </dl>

            <ul className="wa-flows" aria-label="Message flows">
              {i.flows.map((f) => (
                <li key={f.id} className="wa-flow">
                  <div>
                    <b>{f.label}</b>
                    <span>{f.description}</span>
                  </div>
                  <StatusPill status={FLOW_STATE[f.state]} />
                </li>
              ))}
            </ul>

            <p className="wa-privacy">
              <Lock aria-hidden="true" />
              <span>
                <b>Privacy and consent.</b> Audio is kept {i.privacy.audioRetentionDays} days and transcripts {i.privacy.transcriptRetentionDays} days. {i.privacy.storage}{" "}
                {i.privacy.transcription} {i.privacy.consent}
              </span>
            </p>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {i.status === "disconnected" && i.error && (
        <div className="wa-alert" role="alert">
          <TriangleAlert aria-hidden="true" />
          <div className="wa-alert-body">
            <strong>{i.error.title}</strong>
            <span>
              {i.error.detail} Since <When iso={i.error.since} today={today} tzLabel={tzLabel} />.
            </span>
          </div>
          {canWrite && (
            <button
              type="button"
              className="btn btn-outline wa-alert-btn"
              onClick={() => toast.success("Reconnect requested", { description: "A workspace admin will be asked to sign in to the provider again." })}
            >
              Reconnect
            </button>
          )}
        </div>
      )}
    </section>
  )
}
