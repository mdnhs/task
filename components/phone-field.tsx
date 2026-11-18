"use client"

import { Field } from "@/components/field"
import { FilterSelect } from "@/components/filter-bar"
import { Input } from "@/components/ui/input"
import type { PhoneCountry, PhoneValue } from "@/lib/phone"

// Country selector (Ireland +353 by default, from the data) and the national number. Used by Account -> Notifications and Settings -> Users.
// `id` prefixes the control ids. `hint` is one short line under the number.
export function PhoneField({
  id, countries, value, onChange, error, hint, required, label = "WhatsApp number",
}: { id: string; countries: PhoneCountry[]; value: PhoneValue; onChange(v: PhoneValue): void; error?: string; hint?: string; required?: boolean; label?: string }) {
  return (
    <div className="od-phone-row">
      <Field label="Country" htmlFor={`${id}-country`}>
        <FilterSelect label="Country" value={value.country} onChange={(c) => onChange({ ...value, country: c })} options={countries.map((c) => ({ value: c.code, label: `${c.name} +${c.dial}` }))} />
      </Field>
      <Field label={label} htmlFor={`${id}-phone`} error={error} hint={error ? undefined : hint} required={required}>
        <Input id={`${id}-phone`} type="tel" inputMode="tel" autoComplete="tel-national" placeholder="e.g. 87 123 4567" value={value.national} onChange={(e) => onChange({ ...value, national: e.target.value.replace(/[^\d\s()-]/g, "") })} />
      </Field>
    </div>
  )
}
