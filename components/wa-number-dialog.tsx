"use client"

import { useState } from "react"
import { toast } from "sonner"

import { PhoneField } from "@/components/phone-field"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { PHONE_DEFAULT_COUNTRY, validE164, nationalDigits } from "@/lib/phone"
import type { PhoneCountry, PhoneValue } from "@/lib/phone"
import { stageNumber } from "@/lib/wa-staged"
import type { WaPersonStatus } from "@/lib/wa-status"

export const WA_STAGE_HINT = "Work notifications and reminders are sent here once the person confirms WhatsApp in their account."

// MOCK: the owner edits or clears the WhatsApp number of one person. The number is only staged: it shows as Pending confirmation until the person confirms it
// themselves (opt-in and code, Account -> Notifications). Changing a verified number resets it to Pending confirmation. Nothing is sent before that.
export function WaNumberDialog({ name, email, countries, current, status, onClose }: { name: string; email: string; countries: PhoneCountry[]; current: PhoneValue | null; status: WaPersonStatus; onClose(): void }) {
  const [value, setValue] = useState<PhoneValue>(current ?? { country: PHONE_DEFAULT_COUNTRY, national: "" })
  const [error, setError] = useState<string | undefined>()
  const dial = countries.find((c) => c.code === value.country)?.dial ?? "353"

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validE164(dial, value.national)) return setError("Enter a valid number, for example 87 123 4567.")
    stageNumber(email, { country: value.country, national: nationalDigits(value.national) })
    toast.success("Number saved", { description: "Pending confirmation. Nothing is sent until they confirm." })
    onClose()
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="od-dialog od-form-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>WhatsApp number</DialogTitle>
          <DialogDescription>{name}. {WA_STAGE_HINT}</DialogDescription>
        </DialogHeader>
        <form className="od-form" onSubmit={save} noValidate>
          <PhoneField id="wan" countries={countries} value={value} onChange={(v) => { setValue(v); setError(undefined) }} error={error} hint={status === "verified" ? "Changing a verified number asks them to confirm again." : "Nothing is sent before they confirm."} />
          <div className="od-form-foot">
            {(current || status !== "no_number") && (
              <button type="button" className="btn btn-outline" onClick={() => { stageNumber(email, null); toast.success("Number cleared"); onClose() }}>Clear number</button>
            )}
            <DialogClose render={<button type="button" className="btn btn-outline" />}>Cancel</DialogClose>
            <button type="submit" className="btn btn-primary">Save</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
