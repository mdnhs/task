import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// 1. The mock data store lives in public/data so lib/data.ts can read it from disk, but it is never served over HTTP:
//    it holds every module's and every tenant's records, which would bypass role gating (lib/data.ts reads the files directly).
// 2. Signed-out visitors never get app pages (tenant or platform console): a real redirect before render, so no data streams into the HTML.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (pathname === "/data" || pathname.startsWith("/data/")) return new NextResponse("Not found", { status: 404 })
  if (request.cookies.get("od-auth")?.value !== "out") {
    // loading.tsx gets no route params or search params: pass the pathname (a detail skeleton looks the record up) and the
    // query (a list skeleton opens on the same saved view) on (lib/request-path.ts).
    const headers = new Headers(request.headers)
    headers.set("x-od-path", pathname)
    headers.set("x-od-search", request.nextUrl.search)
    return NextResponse.next({ request: { headers } })
  }
  return NextResponse.redirect(new URL("/sign-in", request.url))
}

export const config = {
  matcher: [
    // The data folder, including its .json files (the pattern below skips anything with an extension).
    "/data",
    "/data/:path*",
    // Everything except the auth pages, Next internals and static files.
    "/((?!(?:sign-in|forgot-password|sign-up|onboarding|api|_next|data)(?:/|$)|favicon.ico|.*\\.[a-z0-9]+$).*)",
  ],
}
