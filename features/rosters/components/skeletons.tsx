import { SkMask } from "@/components/sk"
import { SKELETON_NOW, SKELETON_TODAY, skeletonLocationForm, skeletonLocations, skeletonMyRoster, skeletonPanels, skeletonPayload, skeletonTemplates } from "../skeleton-data"
import { LocationFormPage } from "./location-form"
import { LocationsView } from "./locations-view"
import { MyRosterView } from "./my-roster"
import { RostersView } from "./rosters-view"

// The exact skeleton is the real view masked (SkMask): same filters, boards, forms and grid, so layout and wrapping match by construction. Each draws a TYPICAL static case (skeleton-data.ts):
// no API, no session and no route params (K1, I9), so a loading.tsx can render it before anything is known.
export function RostersSkeleton() {
  return (
    <SkMask label="Loading rosters">
      <RostersView payload={skeletonPayload()} query={{}} today={SKELETON_TODAY} templates={skeletonTemplates()} panels={skeletonPanels()} />
    </SkMask>
  )
}

export function LocationsSkeleton() {
  const d = skeletonLocations()
  return (
    <SkMask label="Loading locations">
      <LocationsView locations={d.locations} people={d.people} truncated={false} today={SKELETON_TODAY.slice(0, 10)} />
    </SkMask>
  )
}

export function LocationFormSkeleton() {
  const d = skeletonLocationForm()
  return (
    <SkMask label="Loading location">
      <LocationFormPage location={d.location} shiftTypes={d.shiftTypes} people={d.people} truncated={false} />
    </SkMask>
  )
}

export function MyRosterSkeleton() {
  return (
    <SkMask label="Loading my roster">
      <MyRosterView mine={skeletonMyRoster()} queue={[]} names={{}} exchanges={[]} people={null} peopleTruncated={false} me="u0" today={SKELETON_TODAY} nowAt={SKELETON_NOW} />
    </SkMask>
  )
}
