"use client"

import { EmptyState } from "@/components/empty-state"
import { StatusPill } from "@/components/status-pill"
import { TEMPLATE_STATUS } from "../logic"
import type { WaTemplate } from "../types"

// "Templates": read-only status of the pre-approved message templates (WhatsApp only allows approved ones outside a 24-hour chat). Managed with the provider, not here.
export function TemplatesList({ templates }: { templates: WaTemplate[] }) {
  if (templates.length === 0) return <EmptyState icon="note-pen" title="No templates yet" text="Templates appear here once they are registered." />
  return (
    <>
      <div className="table-wrap">
        <table className="rtable set-table wa-templates">
          <thead>
            <tr><th>Template</th><th>Used for</th><th>Language</th><th>Status</th></tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t.id}>
                <td data-label="Template"><code className="wa-tpl">{t.name}</code></td>
                <td data-label="Used for">{t.kind}</td>
                <td data-label="Language" className="num">{t.language.toUpperCase()}</td>
                <td data-label="Status">
                  <span className="wa-status-cell">
                    <StatusPill status={TEMPLATE_STATUS[t.status]} tick={false} />
                    {t.reason && <span className="tm">{t.reason}</span>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="od-field-hint">Templates are approved by WhatsApp. A pending or rejected one is not sent until approved.</p>
    </>
  )
}
