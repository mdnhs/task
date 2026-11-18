"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { useSlideDir } from "@/components/data-pagination"
import { EmptyState } from "@/components/empty-state"
import { FilterBar, FilterSeg } from "@/components/filter-bar"
import { Icon } from "@/components/icon"
import { PageHead } from "@/components/page-head"
import { StatusPill } from "@/components/status-pill"
import { When } from "@/components/when"
import { WA_DESCRIPTION } from "../constants"
import { kindsOnWhatsApp, peopleCounts } from "../logic"
import { stopConnect, waStore } from "../store"
import type { WaState } from "../types"
import { KindsTable } from "./kinds-table"
import { MessageLog } from "./message-log"
import { PeopleList, useEffectivePeople } from "./people-list"
import { TemplatesList } from "./templates-list"
import { WA_STATUS } from "./integration-card"

type View = "kinds" | "people" | "log" | "templates"
const VIEWS: View[] = ["kinds", "people", "log", "templates"]

// Settings -> Integrations -> WhatsApp (MOCK, local state only). The four parts are views of one card, switched in place with FilterSeg (ui-rules 30).
export function WhatsAppManageView({ initial, scope, today, tzLabel, canWrite }: { initial: WaState; scope: string; today: string; tzLabel: string; canWrite: boolean }) {
  const [s] = waStore.useStore(initial, scope)
  const [view, setView] = useState<View>("kinds")
  const [off, setOff] = useState(false)
  const dir = useSlideDir(VIEWS.indexOf(view))
  const c = s.connection
  const active = c.status === "active"
  const counts = peopleCounts(useEffectivePeople(s.people, scope))
  const enabled = kindsOnWhatsApp(s.kinds, s.defaultVia)
  const approved = s.templates.filter((t) => t.status === "approved").length

  const heads: Record<View, { title: string; sub: string }> = {
    kinds: { title: "What gets sent", sub: `${enabled} of ${s.kinds.length} kinds go out on WhatsApp. Each person only hears about items in their scope.` },
    people: { title: "People", sub: `${counts.verified} of ${counts.all} can receive WhatsApp messages` },
    log: { title: "Message log", sub: "Recent messages: who, which template, what happened" },
    templates: { title: "Templates", sub: `${approved} of ${s.templates.length} approved` },
  }
  const head = heads[view]

  return (
    <>
      <PageHead title="WhatsApp" subtitle="Notifications to people's WhatsApp" actions={<Link href="/settings/integrations" className="btn btn-outline">Back to integrations</Link>} />
      {!active ? (
        <section className="card set-card">
          <EmptyState
            icon="bubble-chat"
            title={c.status === "connecting" ? "Connecting to WhatsApp" : "WhatsApp is off"}
            text={c.status === "connecting" ? "This takes a moment." : WA_DESCRIPTION}
            action={c.status === "connecting" ? undefined : <Link href="/settings/integrations" className="btn btn-primary">{canWrite ? "Turn on in Integrations" : "Back to integrations"}</Link>}
          />
        </section>
      ) : (
        <>
          <section className="card set-card wa-hero" aria-labelledby="wa-hero-h">
            <div className="wa-hero-main">
              <span className="set-int-ico" aria-hidden="true"><Icon name="bubble-chat" /></span>
              <div className="wa-hero-text">
                <h2 id="wa-hero-h">{c.businessName}</h2>
                <div className="wa-hero-meta">
                  <StatusPill status={WA_STATUS.active} tick={false} />
                  <span className="num">{c.number}</span>
                  {c.lastEventAt && <span className="tm">Connected <When iso={c.lastEventAt} today={today} tzLabel={tzLabel} /></span>}
                </div>
              </div>
              {canWrite && <button type="button" className="btn btn-outline wa-off" onClick={() => setOff(true)}>Turn off</button>}
            </div>
            <dl className="wa-counts" aria-label="Messages today">
              <div className="wa-count"><dt>Sent today</dt><dd className="num">{c.today.sent}</dd></div>
              <div className="wa-count"><dt>Delivered</dt><dd className="num">{c.today.delivered}</dd></div>
              <div className="wa-count" data-bad={c.today.failed > 0 || undefined}><dt>Failed</dt><dd className="num">{c.today.failed}</dd></div>
            </dl>
          </section>

          <FilterBar>
            <FilterSeg<View>
              label="WhatsApp sections"
              value={view}
              onChange={setView}
              options={[
                { value: "kinds", label: "What gets sent" },
                { value: "people", label: <>People <span className="num">{counts.all}</span></> },
                { value: "log", label: "Message log" },
                { value: "templates", label: "Templates" },
              ]}
            />
          </FilterBar>
          <section key={view} className="card set-card od-slide" data-slide={dir} aria-labelledby="wa-view-h" data-readonly={canWrite ? undefined : ""}>
            <div className="card-head">
              <div>
                <h2 id="wa-view-h">{head.title}</h2>
                <div className="sub">{head.sub}</div>
              </div>
            </div>
            {view === "kinds" && <KindsTable kinds={s.kinds} defaultVia={s.defaultVia} plan={s.plan} canWrite={canWrite} />}
            {view === "people" && <PeopleList people={s.people} countries={s.countries} canWrite={canWrite} today={today} tzLabel={tzLabel} scope={scope} />}
            {view === "log" && <MessageLog messages={s.messages} today={today} tzLabel={tzLabel} />}
            {view === "templates" && <TemplatesList templates={s.templates} />}
          </section>
        </>
      )}
      <ConfirmDialog
        open={off}
        onOpenChange={setOff}
        title="Turn off WhatsApp?"
        text="People stop getting WhatsApp messages. Their numbers and choices are kept."
        confirmLabel="Turn off"
        destructive
        onConfirm={() => {
          stopConnect(today)
          toast.success("WhatsApp turned off")
        }}
      />
    </>
  )
}
