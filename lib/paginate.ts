export type Page<T> = { rows: T[]; page: number; pageCount: number; from: number; to: number; total: number }

// Slices already filtered and sorted items. `page` is clamped to 1..pageCount; pageCount is at least 1 even when empty.
export function paginate<T>(items: T[], page: number, size: number): Page<T> {
  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / size))
  const p = Number.isFinite(page) ? Math.min(Math.max(Math.trunc(page), 1), pageCount) : 1
  const start = (p - 1) * size
  const rows = items.slice(start, start + size)
  return { rows, page: p, pageCount, from: total ? start + 1 : 0, to: start + rows.length, total }
}

// Page numbers to render: first, last and current ±1, with "ellipsis" over a gap. A gap of one page shows that page instead.
export function pageList(page: number, pageCount: number): (number | "ellipsis")[] {
  const keep = new Set([1, pageCount, page - 1, page, page + 1])
  const nums = [...keep].filter((n) => n >= 1 && n <= pageCount).sort((a, b) => a - b)
  const out: (number | "ellipsis")[] = []
  nums.forEach((n, i) => {
    const prev = nums[i - 1]
    if (prev !== undefined && n - prev === 2) out.push(prev + 1)
    else if (prev !== undefined && n - prev > 2) out.push("ellipsis")
    out.push(n)
  })
  return out
}
