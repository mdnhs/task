"use client"

// Sortable column header (D6). The <th> carries aria-sort; the label is a button that toggles the direction
// (a new column starts at its `first` direction). The arrow is CSS (`.od-sort` in kit.css): faint until hover,
// solid and pointing the sort's way on the active column.
export type SortState<K extends string> = { key: K; dir: "asc" | "desc" }

export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  first = "asc",
  className,
}: {
  label: string
  sortKey: K
  sort: SortState<K>
  onSort(next: SortState<K>): void
  /** Direction on the first click (numbers and dates usually start high: "desc"). */
  first?: "asc" | "desc"
  className?: string
}) {
  const active = sort.key === sortKey
  const next: SortState<K> = { key: sortKey, dir: active ? (sort.dir === "asc" ? "desc" : "asc") : first }
  return (
    <th className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="od-sort" data-active={active || undefined} data-dir={active ? sort.dir : first} onClick={() => onSort(next)}>
        {label}
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 2.5v7M3 6.5l3 3 3-3" />
        </svg>
      </button>
    </th>
  )
}
