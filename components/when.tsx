import { formatDate, formatDue, formatTime } from "@/lib/dates"

// Formatted date/time plus the tenant's timezone label, e.g. "Today 3:00 PM UK time".
// `tzLabel` always comes from the org settings; nothing is hard-coded here.
export function When({ iso, today, tzLabel, mode = "due" }: { iso: string; today: string; tzLabel: string; mode?: "due" | "date" | "time" }) {
  const text = mode === "due" ? formatDue(iso, today) : mode === "date" ? formatDate(iso) : formatTime(iso)
  const withTz = mode === "time" || (mode === "due" && text.includes(":"))
  return (
    <time dateTime={iso} className="od-when">
      {text}
      {withTz && tzLabel ? <span className="od-tz"> {tzLabel}</span> : null}
    </time>
  )
}
