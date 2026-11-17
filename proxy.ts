import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { appOrigin } from "@/lib/api/config"
import { violatesSameOrigin } from "@/lib/csrf"

// 1. The mock data store lives in public/data so lib/data.ts can read it from disk, but it is never served over HTTP:
//    it holds every module's and every tenant's records, which would bypass role gating (lib/data.ts reads the files directly).
// 2. Next server actions (a POST carrying `next-action`) get an Origin check of their own (B6 I6 layer 3, defence in depth): Next compares Origin
//    with Host but lets a request with NO Origin through with a warning. A browser always sends Origin on a POST, so a missing one is refused.
// 3. Signed-out visitors never get app pages (tenant or platform console): a real redirect before render, so no data streams into the HTML.
//    This is an optimistic check only (Next docs: proxy is not an authorisation layer); the real check is the session lookup in the (app) layout.
// /v1/* and /api/* are not matched at all: their route handlers (lib/api/bff.ts) own the tenant, cookie and CSRF rules.
const PUBLIC_PAGE = /^\/(?:sign-in|forgot-password|sign-up|onboarding)(?:\/|$)/

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname === "/data" || pathname.startsWith("/data/")) return new NextResponse("Not found", { status: 404 })

  if (request.method === "POST" && request.headers.has("next-action")) {
    const origin = appOrigin()
    // Fail closed like the BFF: in production an unknown web origin refuses every server action (the Host header is client-controlled behind a lax edge).
    // Only development and tests fall back to the request's own Host.
    if (origin === null && process.env.NODE_ENV === "production") return new NextResponse("Forbidden", { status: 403 })
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
    if (violatesSameOrigin(request.headers, { origin, host })) return new NextResponse("Forbidden", { status: 403 })
  }

  if (!PUBLIC_PAGE.test(pathname) && request.cookies.get("od-auth")?.value === "out") return NextResponse.redirect(new URL("/sign-in", request.url))

  // loading.tsx gets no route params or search params: pass the pathname (a detail skeleton looks the record up) and the
  // query (a list skeleton opens on the same saved view) on (lib/request-path.ts).
  const headers = new Headers(request.headers)
  headers.set("x-od-path", pathname)
  headers.set("x-od-search", request.nextUrl.search)
  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: [
    // The data folder, including its .json files (the pattern below skips anything with an extension).
    "/data",
    "/data/:path*",
    // Everything except the BFF (v1, api), Next internals and static files. The auth pages ARE matched now (server-action Origin check); the redirect skips them.
    "/((?!(?:v1|api|_next|data)(?:/|$)|favicon.ico|.*\\.[a-z0-9]+$).*)",
  ],
}
