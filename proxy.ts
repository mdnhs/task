import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Signed-out visitors never get tenant pages: a real redirect before render, so no data streams into the HTML.
export function proxy(request: NextRequest) {
  if (request.cookies.get("od-auth")?.value !== "out") return NextResponse.next()
  return NextResponse.redirect(new URL("/sign-in", request.url))
}

export const config = {
  // Everything except the auth pages, the platform console, Next internals and static files.
  matcher: ["/((?!(?:sign-in|forgot-password|sign-up|onboarding|platform|api|_next|data)(?:/|$)|favicon.ico|.*\\.[a-z0-9]+$).*)"],
}
