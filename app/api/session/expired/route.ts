// Where getSession sends a dead session: clears the cookies once, then /sign-in?reason=expired (lib/session-route.ts).
import { expireSession } from "@/lib/session-route"

export const dynamic = "force-dynamic"

export const GET = (req: Request) => expireSession(req)
