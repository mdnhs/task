// Better Auth through the same origin (B6 ruling I4): sign-in, sign-up, verification, password reset, two-factor and sign-out.
// The session cookie is set by the API, replayed unchanged, and never readable by JS. /list-sessions (raw tokens) is a 404 (I21).
import { forwardToApi } from "@/lib/api/bff"

export const dynamic = "force-dynamic"

const handle = (req: Request) => forwardToApi(req, { prefix: "/api/auth", deny: /^\/api\/auth\/list-sessions\/?$/i })

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE }
