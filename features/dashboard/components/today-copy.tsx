import { Icon } from "@/components/icons"
import { formatDateYear, formatTime } from "@/lib/dates"
import type { TodayCounts } from "@/lib/today"
import type { TodayData } from "@/lib/today-data"

// Compact copy for the Today card, shared by the card and its skeleton so both wrap the same.
// The client prefers numbers and icons to sentences: names are first names only, lists cap at 3 with "+N".

export const todaySub = (day: TodayData["day"]) => `${formatDateYear(day.key)} · from ${formatTime(day.startsAt)}`

export function shortNames(names: string[], max = 3) {
  const first = [...new Set(names.map((n) => n.split(" ")[0]))]
  return first.length > max ? `${first.slice(0, max).join(", ")} +${first.length - max}` : first.join(", ")
}

export function teamLines(team: NonNullable<TodayData["team"]>, reports: number) {
  return [
    { href: "/tasks?due=overdue", n: team.overdue.count, label: "team overdue", who: shortNames(team.overdue.items.map((i) => i.who)) },
    { href: "/daily-reports", n: team.missing.length, label: "reports missing", who: shortNames(team.missing.map((m) => m.who)) },
    { href: "/daily-reports", n: reports, label: "reports to review", who: "" },
  ]
}

// The closed card's line: three icon + number chips instead of "0 overdue · 0 due today · 0 high priority".
export function TodayChipCounts({ counts }: { counts: TodayCounts }) {
  return (
    <span className="today-chip-m">
      <span className="tc" data-tone={counts.overdue > 0 ? "bad" : undefined} title="Overdue"><Icon name="clock" />{counts.overdue}</span>
      <span className="tc" title="Due today"><Icon name="task" />{counts.dueToday}</span>
      <span className="tc" data-tone={counts.high > 0 ? "warn" : undefined} title="High priority"><Icon name="flag" />{counts.high}</span>
    </span>
  )
}
