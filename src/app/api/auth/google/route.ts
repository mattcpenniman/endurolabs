/** Start Google sign-in, binding the callback to this browser with state and PKCE. */
import { NextRequest, NextResponse } from "next/server";
import {
  createGoogleFlow, googleAuthorizationUrl, googleConfig,
  GOOGLE_FLOW_COOKIE, GOOGLE_FLOW_SECONDS,
} from "@/lib/google-auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = googleConfig();
  if (!config) {
    return NextResponse.redirect(new URL("/login?error=google_unavailable", request.url));
  }
  const flow = createGoogleFlow(request.nextUrl.searchParams.get("redirect"));
  const response = NextResponse.redirect(googleAuthorizationUrl(config, flow));
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(GOOGLE_FLOW_COOKIE, JSON.stringify(flow), {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/api/auth/google", maxAge: GOOGLE_FLOW_SECONDS,
  });
  return response;
}
