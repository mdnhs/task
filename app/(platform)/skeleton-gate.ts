// The console skeletons' gate (B6 ruling I9, K1): a loading.tsx never asks the API who the caller is, so it assumes active staff and checks the staff
// ROLE from the seed operator only. A person the real gate (./gate.tsx) refuses sees the skeleton, then the "Access restricted" page.
import { getOperator, requireStaff, type PlatformAction, type StaffMember } from "@/features/platform"

export async function skeletonGate(action: PlatformAction, _label?: string): Promise<{ denied: true } | { op: StaffMember }> {
  void _label
  const op = await getOperator()
  return requireStaff(op, action) ? { op } : { denied: true }
}
