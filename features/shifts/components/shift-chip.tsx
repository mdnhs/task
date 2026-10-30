import { formatDate } from "@/lib/dates"
import type { ShiftOccurrence } from "@/lib/shifts"

// One shift in the week grid: pattern name and tenant-time hours. A night shift marks its next-day end with "+1".
export function ShiftChip({ occ }: { occ: ShiftOccurrence }) {
  const w = occ.window
  return (
    <span className="sh-chip" data-night={w.endsNextDay || undefined} title={w.endsNextDay ? `Ends ${formatDate(w.end)}` : undefined}>
      <span className="sh-chip-name" title={occ.pattern.name}>{occ.pattern.name}</span>
      <span className="sh-chip-time num">
        {w.start.slice(11, 16)}–{w.end.slice(11, 16)}
        {w.endsNextDay && (
          <>
            {" "}
            <b className="sh-next" aria-hidden="true">+1</b>
            <span className="sr-only">, ends {formatDate(w.end)}</span>
          </>
        )}
      </span>
    </span>
  )
}
