import { Sk } from "@/components/sk"

// Page title row. Uses the dashboard's .head / .head-actions classes.
export function PageHead({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="head-actions">{actions}</div>}
    </div>
  )
}

// Browser-measured: h1 line 40px (31px at ≤640), subtitle line 20px with 8px gap, buttons 46px (shadcn Button size lg; 44px at ≤640,
// where they share the row like .head-actions .btn). `actions` = button widths measured at 1440 (a number = that many 133px buttons).
// `wrap`: the page's subtitle wraps to a second line on phones (≤640), so the skeleton shows a second line there only.
// `sub`: subtitle width (it decides whether the actions still fit beside the text or wrap below it).
// `text`: the real title and subtitle as ghost text, for headings that wrap on phones (for example a tenant name).
export function PageHeadSkeleton({ actions = 0, wrap = false, btn = 46, sub = 300, text }: { actions?: number | number[]; wrap?: boolean; btn?: number; sub?: number; text?: { title: string; subtitle?: string } }) {
  const widths = typeof actions === "number" ? Array.from({ length: actions }, () => 133) : actions
  return (
    <div className="head">
      <div>
        {text ? (
          <>
            <h1><span className="sk-ghost">{text.title}</span></h1>
            {text.subtitle && <p><span className="sk-ghost">{text.subtitle}</span></p>}
          </>
        ) : (
          <>
            <span className="sk-line sk-h1"><Sk w={220} h="var(--sk-h1,32px)" r={10} /></span>
            <Sk w={sub} h={14} lh={20} style={{ marginTop: 8 }} />
            {wrap && <Sk w={160} h={14} lh={20} className="sk-wrap" />}
          </>
        )}
      </div>
      {widths.length > 0 && (
        <div className="head-actions">
          {widths.map((w, i) => (
            <Sk key={i} w={w} h={`calc(${btn}px - var(--sk-btn-d,0px))`} r={14} className="sk-btn" />
          ))}
        </div>
      )}
    </div>
  )
}
