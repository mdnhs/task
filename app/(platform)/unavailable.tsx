import { NotAvailableYet } from "@/features/shell"

// The state of a console page that has no API behind it (B6 I16): shown unless ENABLE_MOCK_MODULES=1 (see features/platform/mock-gate.ts).
export const Unavailable = ({ label }: { label: string }) => (
  <NotAvailableYet moduleLabel={label} home={{ href: "/platform", label: "Back to Overview" }} text={`${label} has no platform API yet. It is coming in a later release.`} />
)
