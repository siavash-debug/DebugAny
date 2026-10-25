import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "./lib/session-values";

/**
 * Fast redirect for signed-out visitors. This is UX only — every protected
 * API call is authorized server-side by the API's session guard.
 */
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE);
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/issues/:path*", "/settings/:path*"]
};
