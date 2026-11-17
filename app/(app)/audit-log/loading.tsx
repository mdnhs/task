import { AuditSkeleton } from "@/features/audit"

// Static: the typical first page (the log is a full page of rows). Never reads the session or the API.
export default function Loading() {
  return <AuditSkeleton rows={60} />
}
