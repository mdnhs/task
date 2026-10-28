import { formatLeft, isoSeconds } from "../logic"

// Time left on a support grant. `now` is the org clock in seconds (useOrgNow); null until the client clock is known.
export function Countdown({ expiresAt, now }: { expiresAt: string; now: number | null }) {
  if (now === null) return <span className="pf-count num" aria-hidden="true">--:--:--</span>
  const left = formatLeft(isoSeconds(expiresAt) - now)
  return left ? <span className="pf-count num" aria-label={`${left} left`}>{left} left</span> : <span className="pf-count">Expired</span>
}
