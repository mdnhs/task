import type { CSSProperties } from "react"

import { scaledRadius } from "@/lib/appearance"
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
  /** `null` = no inline width, so a responsive width from the className applies (inline styles beat classes). */
  w?: number | string | null
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
        width: w ?? undefined,
        height: h,
        borderRadius: scaledRadius(r),
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

// Exact skeleton for pages whose layout depends on one record (a task, a shift report): loading.tsx looks the record up and renders
// the real component with its real data, masked (CSS `.sk-mask` in kit.css: text transparent, text blocks tinted) and inert.
// Layout, wrapping and counts are then identical to the loaded page by construction.
export function SkMask({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sk-mask" role="status" aria-label={label} aria-busy="true" inert>
      {children}
    </div>
  )
}
