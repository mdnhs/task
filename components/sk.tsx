import type { CSSProperties } from "react"

import { cn } from "@/lib/utils"

// Skeleton block. Used inside the real component classes (.card, .stat, .item…) so the
// skeleton gets the same paddings, gaps and grid as the loaded UI. See .claude/docs/architecture.md → Skeletons.
// `lh` = the real text's line-box height (measure it in the browser). The block is centred in a box of that height,
// so a skeleton text line takes exactly the space the loaded line will, and nothing jumps when data arrives.
export function Sk({
  w = "100%",
  h = 12,
  r,
  lh,
  className,
  style,
}: {
  w?: number | string
  h?: number | string
  r?: number | "pill" | "circle"
  lh?: number
  className?: string
  style?: CSSProperties
}) {
  if (lh) {
    const { margin, marginTop, marginBottom, ...rest } = style ?? {}
    return (
      <span className="sk-line" style={{ height: lh, margin, marginTop, marginBottom }}>
        <Sk w={w} h={h} r={r} className={className} style={rest} />
      </span>
    )
  }
  return (
    <span
      aria-hidden="true"
      className={cn("sk", className)}
      style={{
        width: w,
        height: h,
        borderRadius: r === "pill" ? 999 : r === "circle" ? "50%" : r,
        ...style,
      }}
    />
  )
}

// Wrapper that announces loading once for screen readers; the blocks inside are aria-hidden.
export function SkGroup({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className} role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}
