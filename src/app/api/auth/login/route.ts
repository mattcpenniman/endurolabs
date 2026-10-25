/** Password sign-in has been replaced by the Google authorization flow. */
import { NextResponse } from "next/server";

export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ error: "Please sign in with Google", signInUrl: "/api/auth/google" }, { status: 410 });
}
