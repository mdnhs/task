import { formatDateTime } from "@opsdesk/domain/dates"

/** Older proposal lines were written with raw wall-clock ISO values ("Proposed new dates 2026-11-22T18:22 to ..."); they read as dates now. */
const ISO_WALL = String.raw`(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?)?)`
const LEGACY_PROPOSAL = new RegExp(`^Proposed new dates ${ISO_WALL} to ${ISO_WALL}(: [\\s\\S]*)?$`)

export const readableProposalText = (text: string): string =>
  text.replace(LEGACY_PROPOSAL, (_m, a: string, b: string, rest?: string) => `Proposed new dates ${formatDateTime(a)} to ${formatDateTime(b)}${rest ?? ""}`)
