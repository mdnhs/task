"use client"

import type { TemplateSection } from "../types"

// Sticky "done/total" with the shared .progress bar (fill animation + scroll-reveal come from opsdesk.css) and the
// sections that still need attention, as buttons that open and scroll to the section.
export function ReportProgress({
  done,
  total,
  attention,
  onJump,
}: {
  done: number
  total: number
  attention: TemplateSection[]
  onJump(id: string): void
}) {
  const pct = total ? Math.round((done / total) * 100) : 0
  return (
    <aside className="card rf-progress" aria-label="Report progress">
      <div className="rf-prog-head">
        <strong>
          {done}/{total}
        </strong>
        <span>fields completed</span>
      </div>
      <div suppressHydrationWarning className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Fields completed">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="rf-attn">
        <h3>Needs attention</h3>
        {attention.length === 0 ? (
          <p className="td-muted">Every section is complete.</p>
        ) : (
          <ul>
            {attention.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onJump(s.id)}>
                  {s.n}. {s.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
