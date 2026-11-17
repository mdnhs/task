// The browser's only way to the API (B6 ruling I4): same-origin /v1/*, forwarded to API_URL with the tenant, cookies and CSRF rules of lib/api/bff.ts.
// Stripe webhooks (/webhooks/billing/*) are NOT here: they go to the API host directly.
import { forwardToApi } from "@/lib/api/bff"

export const dynamic = "force-dynamic"

const handle = (req: Request) => forwardToApi(req, { prefix: "/v1" })

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE }
