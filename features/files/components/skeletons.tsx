import { PageHeadSkeleton } from "@/components/page-head"
import {
  PagerSkeleton,
  needsPager,
  pageRows,
} from "@/components/pager-skeleton"
import { Sk, SkGroup } from "@/components/sk"
import { FILES_PAGE_SIZE } from "../types"

// Mirrors FilesView: PageHead, 4 stat cards, then the .files-card with tabs, filters and rows. `tab` picks the Employee documents (default) or Client files body.
export function FilesSkeleton({
  rows = 10,
  canWrite = true,
  tab = "employee",
}: {
  rows?: number
  canWrite?: boolean
  tab?: "employee" | "client"
}) {
  return (
    <SkGroup label="Loading files" className="sk-page">
      <PageHeadSkeleton wrap />
      <section className="stats">
        {Array.from({ length: 4 }, (_, i) => (
          <article key={i} className="stat">
            <div className="stat-top">
              <Sk w="55%" h={14} lh={22} />
            </div>
            <Sk
              w={60}
              h={40}
              r={10}
              lh={46}
              className="sk-val"
              style={{ marginTop: "auto" }}
            />
            <Sk w="70%" h={11} lh={17} />
          </article>
        ))}
      </section>
      <div className="card files-card">
        <div className="files-tabs">
          <Sk w={332} h={50} r="pill" />
        </div>
        {/* the real tab bodies are each wrapped in a <div hidden> */}
        {tab === "client" ? (
          <div>
            <ClientBodySkeleton rows={rows} />
          </div>
        ) : (
          <div>
            <div className="od-filters">
              <Sk h={40} r="pill" className="sk-fsearch" />
              <Sk w={140} h={40} r="pill" />
              <Sk w={140} h={40} r="pill" />
            </div>
            <div className="table-wrap">
              <table className="rtable files-table">
                <thead>
                  <tr>
                    {[64, 32, 56, 44, 44, 76, 8].map((w, i) => (
                      <th key={i}>
                        <Sk w={w} h={10} lh={16} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from(
                    { length: pageRows(rows, FILES_PAGE_SIZE) },
                    (_, i) => (
                      <tr key={i}>
                        <td data-label="Document">
                          <Sk w={110} h={12} lh={18.84} />
                          <Sk w={80} h={10} lh={16} />
                        </td>
                        <td data-label="Dept">
                          <Sk w={58} h={19} r={6} className="sk-dep" />
                        </td>
                        <td data-label="Received">
                          <Sk w={70} h={12} lh={18.8} />
                        </td>
                        <td data-label="Expiry">
                          <Sk w={70} h={12} lh={18.8} />
                          <Sk w={60} h={10} lh={16} />
                        </td>
                        <td data-label="Status">
                          <Sk w={96} h={29.4} r={8} />
                        </td>
                        <td data-label="Confirmed by">
                          <Sk w={80} h={12} lh={18.8} />
                        </td>
                        <td data-label="Actions">
                          <div className="files-actions">
                            <Sk w={85} h={32.1} r={14} />
                            {canWrite && <Sk w={116} h={32.1} r={14} />}
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
            {needsPager(rows, FILES_PAGE_SIZE) && (
              <PagerSkeleton rows={rows} size={FILES_PAGE_SIZE} />
            )}
          </div>
        )}
      </div>
    </SkGroup>
  )
}

// Client files tab body: search + status filter, table (client, contacts, contract, status, outstanding, action) and pager.
function ClientBodySkeleton({ rows }: { rows: number }) {
  return (
    <>
      <div className="od-filters">
        <Sk h={40} r="pill" className="sk-fsearch" />
        <Sk w={140} h={40} r="pill" />
      </div>
      <div className="table-wrap">
        <table className="rtable files-table files-clients">
          <thead>
            <tr>
              {[44, 56, 52, 44, 72, 8].map((w, i) => (
                <th key={i}>
                  <Sk w={w} h={10} lh={16} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: pageRows(rows, FILES_PAGE_SIZE) }, (_, i) => (
              <tr key={i}>
                <td data-label="Client">
                  <Sk w={120} h={12} lh={18.84} className="sk-2l" />
                  <Sk w={90} h={10} lh={16} className="sk-2s" />
                </td>
                <td data-label="Contacts">
                  <Sk w={110} h={12} lh={18.8} />
                </td>
                <td data-label="Contract">
                  <Sk w={70} h={12} lh={18.8} />
                </td>
                <td data-label="Status">
                  <Sk w={96} h={29.4} r={8} />
                </td>
                <td data-label="Outstanding">
                  <Sk w={90} h={12} lh={18.8} />
                </td>
                <td data-label="Actions">
                  <div className="files-actions">
                    <Sk w={85} h={32.1} r={14} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {needsPager(rows, FILES_PAGE_SIZE) && (
        <PagerSkeleton rows={rows} size={FILES_PAGE_SIZE} />
      )}
    </>
  )
}
