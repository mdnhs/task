"use client"

import { Children, isValidElement, useRef, useState } from "react"
import Link from "next/link"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from "@/components/ui/pagination"
import { slideDir } from "@/lib/motion"
import type { SlideDir } from "@/lib/motion"
import { pageList } from "@/lib/paginate"

export type DataPaginationProps = {
  page: number
  pageCount: number
  total: number
  from: number
  to: number
  /** Accessible name of the pager, e.g. "Tasks pages". */
  label: string
  /** Button mode (client state). */
  onPageChange?(page: number): void
  /** Link mode (page kept in the URL). With onPageChange too, a plain click is handled in place (no navigation) while the link still works for new tabs. */
  href?(page: number): string
}

// Shared pager for data tables. Renders nothing for a single page. Put it inside the table's card, right after the table.
export function DataPagination({ page, pageCount, total, from, to, label, onPageChange, href }: DataPaginationProps) {
  const root = useRef<HTMLDivElement>(null)
  if (pageCount <= 1) return null

  // Keep the table's top in view: only scroll when the card's top is above the viewport.
  const keepInView = () => {
    const card = root.current?.closest<HTMLElement>(".card") ?? root.current?.parentElement
    if (!card || card.getBoundingClientRect().top >= 0) return
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    card.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" })
  }

  const item = (p: number, name: string, children: React.ReactNode, opts: { disabled?: boolean; current?: boolean; className?: string } = {}) => {
    const common = {
      variant: "ghost" as const,
      className: opts.className,
      "aria-label": name,
      "aria-current": opts.current ? ("page" as const) : undefined,
    }
    if (opts.disabled || (!href && !onPageChange)) {
      return <Button {...common} disabled={opts.disabled}>{children}</Button>
    }
    if (href) {
      return (
        <Button {...common} nativeButton={false} render={
            <Link
              href={href(p)}
              scroll={false}
              onClick={(e) => {
                if (onPageChange && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
                  e.preventDefault()
                  onPageChange(p)
                }
                keepInView()
              }}
            />
          }>
          {children}
        </Button>
      )
    }
    return (
      <Button
        {...common}
        onClick={() => {
          onPageChange?.(p)
          keepInView()
        }}
      >
        {children}
      </Button>
    )
  }

  return (
    <div className="od-pager" ref={root}>
      <p className="od-pager-sum num">
        {`Showing ${from}–${to} of ${total}`}
      </p>
      <Pagination aria-label={label} className="od-pager-nav">
        <PaginationContent>
          <PaginationItem>
            {item(page - 1, "Go to previous page", (
              <>
                <ChevronLeftIcon aria-hidden />
                <span className="od-pager-txt">Previous</span>
              </>
            ), { disabled: page <= 1, className: "od-pager-step" })}
          </PaginationItem>
          {pageList(page, pageCount).map((n, i) =>
            n === "ellipsis" ? (
              <PaginationItem key={`e${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={n}>{item(n, `Page ${n}`, n, { current: n === page })}</PaginationItem>
            ),
          )}
          <PaginationItem>
            {item(page + 1, "Go to next page", (
              <>
                <span className="od-pager-txt">Next</span>
                <ChevronRightIcon aria-hidden />
              </>
            ), { disabled: page >= pageCount, className: "od-pager-step" })}
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}

// Direction of the last change of an index (page, tab, step): "next" when it grew, "prev" when it shrank. First render: none.
export function useSlideDir(index: number): SlideDir | undefined {
  const [s, setS] = useState<{ index: number; dir?: SlideDir }>({ index })
  if (s.index !== index) {
    const next = { index, dir: slideDir(s.index, index) }
    setS(next)
    return next.dir
  }
  return s.dir
}

// <tbody> for a paged table: a page change remounts the rows, which slide in from the paging side (next = from the right).
// A filter or search that changes the set of rows (row keys) remounts and slides in from the right the same way, so the
// whole body moves as one; rows are plain <tr>, because per-row enter/exit made the table jump. The table clips
// horizontally only while the slide runs (`table:has(>tbody[data-slide])` in settings.css), so no horizontal scrollbar
// flashes; the attribute is dropped at the end.
export function PagedBody({ page, children, className }: { page: number; children: React.ReactNode; className?: string }) {
  const rows = Children.toArray(children)
    .map((c) => (isValidElement(c) ? c.key : ""))
    .join()
  const [s, setS] = useState<{ page: number; rows: string; n: number; dir?: SlideDir }>({ page, rows, n: 0 })
  let cur = s
  if (s.page !== page || s.rows !== rows) {
    cur = { page, rows, n: s.n + 1, dir: s.page !== page ? slideDir(s.page, page) : "next" }
    setS(cur)
  }
  const dir = cur.dir
  return (
    <tbody
      key={cur.n}
      className={className ? `od-slide ${className}` : "od-slide"}
      data-slide={dir}
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.removeAttribute("data-slide")
      }}
    >
      {children}
    </tbody>
  )
}
