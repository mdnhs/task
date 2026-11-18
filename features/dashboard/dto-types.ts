// The dashboard DTO as the generated schema types it (lib/api/schema.d.ts), for callers that want the compile-time shape.
import type { Res } from "@/lib/api/client"
export type DashboardDto = Res<"/v1/dashboard", "get">
