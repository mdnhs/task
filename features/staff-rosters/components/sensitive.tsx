// Sensitive staff fields (FR-STAFF-03). The server already dropped the value for roles without write access, so
// `value === undefined` while `allowed` is false means "Restricted"; with access it means nothing was recorded.
export function Sensitive({ value, allowed }: { value?: string; allowed: boolean }) {
  if (!allowed) return <span className="sr-restricted">Restricted</span>
  return value ? <>{value}</> : <span className="sr-none">Not recorded</span>
}
