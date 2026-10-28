"use client"

import { useState } from "react"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { LINK_KIND, LINK_KIND_ORDER } from "../types"
import type { LinkKind, LinkRef, LinkTargets } from "../types"

// FR-WA-02: link a message to a user, task, client issue or report item. Mount with a fresh `key` per open.
export function LinkDialog({
  open,
  onOpenChange,
  targets,
  linked,
  excerpt,
  onLink,
}: {
  open: boolean
  onOpenChange(o: boolean): void
  targets: LinkTargets
  /** Records this message already links to; they are left out of the list. */
  linked: LinkRef[]
  excerpt: string
  onLink(link: LinkRef): void
}) {
  const free = (k: LinkKind) => targets[k].filter((t) => !linked.some((l) => l.kind === k && l.ref === t.ref))
  const [kind, setKind] = useState<LinkKind>(LINK_KIND_ORDER.find((k) => free(k).length) ?? "task")
  const options = free(kind)
  const [ref, setRef] = useState(options[0]?.ref ?? "")
  const picked = options.find((o) => o.ref === ref)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Link message to a record</DialogTitle>
          <DialogDescription className="wa-excerpt">{excerpt}</DialogDescription>
        </DialogHeader>
        <form
          className="od-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!picked) return
            onLink(picked)
            onOpenChange(false)
          }}
        >
          <Field label="Record type" htmlFor="wa-link-kind" required>
            <FilterSelect
              label="Record type"
              value={kind}
              options={LINK_KIND_ORDER.map((k) => ({ value: k, label: LINK_KIND[k] }))}
              onChange={(k) => {
                setKind(k)
                setRef(free(k)[0]?.ref ?? "")
              }}
            />
          </Field>
          <Field label={LINK_KIND[kind]} htmlFor="wa-link-ref" hint={options.length ? picked?.label : "Everything of this type is already linked."} required>
            {options.length ? (
              <FilterSelect label={LINK_KIND[kind]} value={ref} options={options.map((o) => ({ value: o.ref, label: kind === "user" ? o.ref : `${o.ref} · ${o.label}` }))} onChange={setRef} />
            ) : (
              <input id="wa-link-ref" disabled value="Nothing left to link" readOnly />
            )}
          </Field>
          <div className="od-form-foot">
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary" disabled={!picked}>Link record</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
