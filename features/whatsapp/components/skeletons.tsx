import { PageHeadSkeleton } from "@/components/page-head"
import { Sk, SkGroup } from "@/components/sk"

// Mirrors WhatsappView: PageHead, .wa-integ (collapsed accordion head + chevron, optional failure alert)
// and .wa-inbox (list rows per conversation | thread | context). The inbox has a fixed height, so only the card above it moves the page.
// Text lines are estimated from the integration's text length, measured at desktop width (1440px).
export function WhatsappSkeleton({
  conversations = 7,
  disconnected = false,
  noteLines = 1,
  alertLines = 1,
}: {
  conversations?: number
  disconnected?: boolean
  noteLines?: number
  alertLines?: number
}) {
  return (
    <SkGroup label="Loading WhatsApp" className="sk-page">
      <PageHeadSkeleton />
      <section className="card wa-integ">
        <div className="wa-integ-head">
          <Sk w={44} h={44} r={14} />
          <div className="wa-integ-title">
            <Sk w={210} h={18} lh={26} />
            <div>
              {Array.from({ length: noteLines }, (_, i) => <Sk key={i} w={i === noteLines - 1 && noteLines > 1 ? "30%" : "85%"} h={12} lh={19} />)}
            </div>
          </div>
          <Sk w={180} h={28} r={8} />
          <Sk w={18} h={18} r={4} />
        </div>
        {disconnected && (
          <div className="wa-alert">
            <Sk w={20} h={20} r="circle" />
            <div className="wa-alert-body">
              <Sk w={200} h={13} lh={20} />
              {Array.from({ length: alertLines }, (_, i) => <Sk key={i} w={i === alertLines - 1 && alertLines > 1 ? "40%" : "90%"} h={12} lh={19} />)}
            </div>
            <Sk w={118} h={42} r={14} />
          </div>
        )}
      </section>

      <div className="wa-inbox">
        <section className="card wa-list">
          <div className="wa-list-head">
            <Sk h={40} r="pill" />
            <Sk h={38} r="pill" />
          </div>
          <div className="wa-convs">
            {Array.from({ length: conversations }, (_, i) => (
              <div key={i} className="wa-conv">
                <Sk w={42} h={42} r="circle" />
                <div className="wa-conv-main">
                  <div className="wa-conv-top"><Sk w={110} h={12} lh={20} /><Sk w={44} h={10} /></div>
                  <Sk w="85%" h={10} lh={20} />
                </div>
              </div>
            ))}
          </div>
        </section>
        <section className="card wa-thread">
          <div className="wa-thread-head">
            <Sk w={40} h={40} r="circle" />
            <div className="wa-thread-who">
              <Sk w={130} h={13} lh={21} />
              <Sk w={110} h={10} lh={18} />
            </div>
          </div>
          <div className="wa-msgs">
            <div className="wa-day"><Sk w={64} h={24} r="pill" /></div>
            {[["in", 300, 58], ["out", 260, 58], ["in", 200, 40], ["in", 360, 150]].map(([dir, w, h], i) => (
              <div key={i} className="wa-row" data-dir={dir}>
                <Sk w={w as number} h={h as number} r={18} style={{ maxWidth: "100%" }} />
              </div>
            ))}
          </div>
          <div className="wa-composer">
            <div className="wa-compose-row">
              <Sk h={46} r="pill" style={{ flex: 1 }} />
              <Sk w={46} h={46} r="circle" />
            </div>
          </div>
        </section>
        <aside className="card wa-ctx">
          <div className="wa-ctx-body">
            <div className="wa-ctx-contact">
              <Sk w={42} h={42} r="circle" />
              <div>
                <Sk w={120} h={13} lh={21} />
                <Sk w={150} h={10} lh={18} />
                <Sk w={110} h={10} lh={18} />
              </div>
            </div>
            <Sk w={170} h={28} r={8} />
            <div style={{ width: "100%" }}>
              <Sk w={100} h={10} lh={20} style={{ marginBottom: 8 }} />
              <Sk w={130} h={25} r="pill" />
            </div>
            <div style={{ width: "100%" }}>
              <Sk w={60} h={10} lh={20} style={{ marginBottom: 8 }} />
              <Sk w="90%" h={10} lh={18} />
              <Sk w={110} h={9} lh={17} />
            </div>
          </div>
        </aside>
      </div>
    </SkGroup>
  )
}
