"use client"

import { useRef, useState } from "react"

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"

/** Signature evidence (FR-M1-41): draw with a finger, pen or mouse. Returns a PNG data URL for the in-session preview. */
export function SignatureDialog({ open, onOpenChange, signer, onSave }: { open: boolean; onOpenChange(o: boolean): void; signer: string; onSave(dataUrl: string): void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }
  const ctx = () => {
    const c = canvas.current?.getContext("2d")
    if (!c) return null
    c.lineWidth = 3
    c.lineCap = "round"
    c.lineJoin = "round"
    c.strokeStyle = getComputedStyle(canvas.current!).color
    return c
  }
  function clear() {
    const c = canvas.current
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height)
    setEmpty(true)
  }
  function close(o: boolean) {
    onOpenChange(o)
    if (!o) setEmpty(true)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Sign off</DialogTitle>
          <DialogDescription>Signature by {signer}. Sign inside the box.</DialogDescription>
        </DialogHeader>
        <div className="od-form">
          <canvas
            ref={canvas}
            className="sig-pad"
            width={640}
            height={240}
            aria-label="Signature area"
            onPointerDown={(e) => {
              const c = ctx()
              if (!c) return
              e.currentTarget.setPointerCapture(e.pointerId)
              drawing.current = true
              const p = point(e)
              c.beginPath()
              c.moveTo(p.x, p.y)
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return
              const c = ctx()
              if (!c) return
              const p = point(e)
              c.lineTo(p.x, p.y)
              c.stroke()
              if (empty) setEmpty(false)
            }}
            onPointerUp={() => (drawing.current = false)}
            onPointerCancel={() => (drawing.current = false)}
          />
          <div className="od-form-foot">
            <button type="button" className="btn btn-outline" onClick={clear} disabled={empty}>Clear</button>
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button
              type="button"
              className="btn btn-primary"
              disabled={empty}
              onClick={() => {
                onSave(canvas.current!.toDataURL("image/png"))
                close(false)
              }}
            >
              Save signature
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
