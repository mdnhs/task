"use client"

import { toast } from "sonner"

import { saveDevicePolicies } from "@/app/actions/security"
import { FilterSelect } from "@/components/filter-bar"
import { DEVICE_ALLOWS, DEVICE_FEATURES, allowFor, describePolicy } from "@/lib/devices"
import type { DeviceAllow, DeviceFeature, DevicePolicy } from "@/lib/devices"
import { devicePoliciesStore } from "../store"

// Device access policy (FR-M0-09, CR-02, CR-06): per feature, which devices may use it. Checked on the server for every request.
export function DevicePolicyCard({ policies, canWrite, scopeKey }: { policies: DevicePolicy[]; canWrite: boolean; scopeKey: string }) {
  const [stored, setStored] = devicePoliciesStore.useStore(policies, scopeKey)

  async function change(feature: DeviceFeature, allow: DeviceAllow) {
    const next = [...stored.filter((p) => p.feature !== feature), { feature, allow }]
    const r = await saveDevicePolicies(next)
    if (!r.ok) return toast.error("Could not save the policy")
    setStored(() => next)
    toast.success("Device policy saved", { description: describePolicy({ feature, allow }) })
  }

  return (
    <section className="card set-card" aria-labelledby="set-pol-h">
      <div className="card-head">
        <div>
          <h2 id="set-pol-h">Device access</h2>
          <div className="sub">Where each feature can be used. Register devices on the Devices tab.</div>
        </div>
      </div>
      <ul className="set-list">
        {DEVICE_FEATURES.map((f) => {
          const allow = allowFor(f.value, stored)
          return (
            <li key={f.value} className="dev-policy">
              <div className="dev-policy-text">
                <b>{f.label}</b>
                <span>{describePolicy({ feature: f.value, allow })}</span>
              </div>
              {canWrite && (
                <div className="od-filters">
                  <FilterSelect label={`${f.label} access`} value={allow} options={DEVICE_ALLOWS} onChange={(v) => change(f.value, v as DeviceAllow)} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
