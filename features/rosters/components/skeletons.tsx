import { SkMask } from "@/components/sk"
import type { LeaveQueue, LocationAdminData, MyExchange, MyRosterData, RosterEdit } from "../types"
import type { RosterViewData } from "../view"
import { LocationFormPage } from "./location-form"
import { MyRosterView } from "./my-roster"
import { LocationsView } from "./locations-view"
import { RostersView } from "./rosters-view"

// The exact skeleton is the real view masked (SkMask): same filters, boards and grid, so layout and wrapping match by construction.
export function RostersSkeleton({ data, edit }: { data: RosterViewData; edit?: RosterEdit }) {
  return (
    <SkMask label="Loading rosters">
      <RostersView data={data} edit={edit} />
    </SkMask>
  )
}

export function LocationsSkeleton({ data, scopeKey }: { data: LocationAdminData; scopeKey: string }) {
  return (
    <SkMask label="Loading locations">
      <LocationsView data={data} scopeKey={scopeKey} />
    </SkMask>
  )
}

export function LocationFormSkeleton({ data, id, scopeKey, me, today }: { data: LocationAdminData; id: string; scopeKey: string; me: string; today: string }) {
  return (
    <SkMask label="Loading location">
      <LocationFormPage data={data} id={id} scopeKey={scopeKey} me={me} today={today} />
    </SkMask>
  )
}

export function MyRosterSkeleton({ data, queue, exchange, me, tz, today, scopeKey }: { data: MyRosterData; queue: LeaveQueue; exchange: MyExchange; me: string; tz: string; today: string; scopeKey: string }) {
  return (
    <SkMask label="Loading my roster">
      <MyRosterView data={data} queue={queue} exchange={exchange} me={me} tz={tz} today={today} scopeKey={scopeKey} />
    </SkMask>
  )
}
