/** Complete Google sign-in into an existing EnduroLab account, retaining all owned data. */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { createSession, setSessionCookie } from "@/lib/auth";
import { googleConfig, googleVerifiedEmail, readGoogleFlow, GOOGLE_FLOW_COOKIE } from "@/lib/google-auth";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = googleConfig();
  const origin = config?.origin ?? request.nextUrl.origin;
  const finish = (path: string): NextResponse => {
    const response = NextResponse.redirect(new URL(path, origin));
    response.headers.set("Cache-Control", "no-store");
    response.cookies.set(GOOGLE_FLOW_COOKIE, "", {
      httpOnly: true, secure: process.env.NODE_ENV === "production",
      sameSite: "lax", path: "/api/auth/google", maxAge: 0,
    });
    return response;
  };
  if (!config) return finish("/login?error=google_unavailable");
  const params = request.nextUrl.searchParams;
  const flow = readGoogleFlow(request.cookies.get(GOOGLE_FLOW_COOKIE)?.value, params.get("state"));
  if (!flow) return finish("/login?error=invalid_state");
  if (params.has("error")) return finish("/login?error=google_cancelled");
  const code = params.get("code");
  if (!code) return finish("/login?error=google_failed");
  try {
    const email = await googleVerifiedEmail(config, code, flow.verifier);
    const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (!user) return finish("/login?error=account_not_found");
    await setSessionCookie(await createSession(user.id));
    return finish(flow.redirect);
  } catch {
    // OAuth codes, access tokens, and profile payloads must never enter logs.
    return finish("/login?error=google_failed");
  }
}
