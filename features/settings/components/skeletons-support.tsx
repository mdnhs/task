import { PageHeadSkeleton } from "@/components/page-head"
import { Sk, SkGroup } from "@/components/sk"

// Mirrors SupportAccessView: PageHead with one outline button, then one .set-card with a card head and the grants table (typical: two rows). Intended heights from the
// real classes (h2 line 28, .sub line 17, table cell rows 19/16); T6.9 measures it.
export function SupportAccessSkeleton({ rows = 2, revoke = true }: { rows?: number; revoke?: boolean }) {
  return (
    <SkGroup label="Loading support access" className="sk-page">
      <PageHeadSkeleton actions={[150]} btn={48} />
      <section className="card set-card">
        <div className="card-head">
          <div>
            <Sk w={70} h={18} lh={28} />
            <Sk w={150} h={11} lh={17} style={{ marginTop: 2 }} />
          </div>
        </div>
        <div className="table-wrap">
          <table className="rtable set-table">
            <thead>
              <tr>{[36, 50, 50, 44].concat(revoke ? [54] : []).map((w, i) => <th key={i}><Sk w={w} h={10} lh={15.94} /></th>)}</tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, i) => (
                <tr key={i}>
                  <td data-label="Who"><Sk w={100} h={13} lh={19} /></td>
                  <td data-label="Reason"><Sk w={180} h={13} lh={19} /></td>
                  <td data-label="Expires"><Sk w={110} h={13} lh={19} /></td>
                  <td data-label="Status"><Sk w={70} h={29.4} r={8} /></td>
                  {revoke && <td data-label="Actions"><Sk w={81} h={38} r={12} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </SkGroup>
  )
}
