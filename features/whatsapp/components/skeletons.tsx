import { Icon } from "@/components/icon"
import { PageHeadSkeleton } from "@/components/page-head"
import { Sk, SkGroup } from "@/components/sk"
import { WA_DESCRIPTION, WA_HINT } from "../constants"

// Skeletons of the WhatsApp UI (all three show the typical first visit: WhatsApp not turned on yet, the seed's default). Heights come from the real classes and are
// browser-measured (see the measured values in the comments); text that wraps is ghost text so the line count matches at every width.
const ghost = (t: string) => <span className="sk-ghost">{t}</span>

/** The card in the Integrations grid, mirroring WhatsAppCard (not connected). Same structure as the Google Drive skeleton. */
export function WhatsAppCardSkeleton({ canWrite = true }: { canWrite?: boolean }) {
  return (
    <li className="set-int wa-int">
      <div className="set-int-top">
        <Sk w={44} h={44} r="circle" />
        <div className="set-int-name"><Sk w={82} h={16} lh={22} /><Sk w={110} h={29.4} r={8} /></div>
      </div>
      <p className="set-int-desc">{ghost(WA_DESCRIPTION)}</p>
      <p className="set-int-event">{ghost("Last event: Never connected")}</p>
      <p className="set-int-policy">{ghost(WA_HINT)}</p>
      {canWrite && <div className="set-int-foot"><Sk w={104} h={48} r={14} /></div>}
    </li>
  )
}

/** Settings -> Integrations -> WhatsApp, mirroring WhatsAppManageView with WhatsApp off: the page head and one card with the empty state. */
export function WhatsAppManageSkeleton() {
  return (
    <SkGroup label="Loading WhatsApp" className="sk-page">
      <PageHeadSkeleton actions={[190]} btn={48} sub={190} />
      <section className="card set-card">
        <div className="od-empty">
          <Sk w={56} h={56} r="circle" style={{ marginBottom: 6 }} />
          <Sk w={140} h={18} lh={26} />
          <p>{ghost(WA_DESCRIPTION)}</p>
          <Sk w={196} h={48} r={14} style={{ marginTop: 10 }} />
        </div>
      </section>
    </SkGroup>
  )
}

/** The WhatsApp section of Account -> Notifications, mirroring WhatsAppAccountSection when the admin has not turned WhatsApp on. */
export function WhatsAppAccountSkeleton() {
  return (
    <section className="card set-card wa-acc">
      <div className="card-head">
        <div>
          <Sk w={90} h={18} lh={28} />
          <p className="sub">{ghost("Get notifications on your own WhatsApp, only for what is in your scope")}</p>
        </div>
      </div>
      <div className="wa-note">
        <Sk w={36} h={36} r="circle" />
        <p>{ghost("Your admin has not turned WhatsApp on yet. Once they do, you can add your number here.")}</p>
      </div>
      <p className="wa-stop"><Icon name="info" size={16} />Reply STOP to opt out anytime.</p>
    </section>
  )
}
