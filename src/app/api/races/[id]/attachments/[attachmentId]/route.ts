/** Owner-only attachment downloads and removal. */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { raceAttachments } from "@/lib/db/schema";
import { raceResourceAccess } from "@/lib/races/resource-access";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; attachmentId: string }> };

async function handle(request: Request, context: Context): Promise<Response> {
  try {
    const { id, attachmentId } = await context.params;
    const denied = await raceResourceAccess(id);
    if (denied) return NextResponse.json({ error: denied === 401 ? "Authentication required" : "Race not found" }, { status: denied });
    if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(attachmentId)) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    const filter = and(eq(raceAttachments.id, attachmentId), eq(raceAttachments.activityId, id));
    if (request.method === "DELETE") {
      const removed = await db.delete(raceAttachments).where(filter).returning({ id: raceAttachments.id });
      return NextResponse.json(removed.length ? { success: true } : { error: "Attachment not found" }, { status: removed.length ? 200 : 404 });
    }
    const [attachment] = await db.select().from(raceAttachments).where(filter).limit(1);
    if (!attachment) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    return new Response(new Uint8Array(Buffer.from(attachment.contentBase64, "base64")), { headers: {
      "Content-Type": attachment.contentType,
      "Content-Disposition": `attachment; filename="race-attachment"; filename*=UTF-8''${encodeURIComponent(attachment.filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    } });
  } catch (error) {
    console.error("Race attachment request failed:", error);
    return NextResponse.json({ error: "Unable to access attachment" }, { status: 500 });
  }
}

export const GET = handle;
export const DELETE = handle;
