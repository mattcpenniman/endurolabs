/** Private race results link and bounded attachment uploads. */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { raceAttachments, raceResources, runActivities } from "@/lib/db/schema";
import { raceResourceAccess } from "@/lib/races/resource-access";
import { MAX_RACE_ATTACHMENT_BYTES, MAX_RACE_ATTACHMENTS, parseResultsUrl, validateRaceAttachment } from "@/lib/races/resources";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
const privateHeaders = { "Cache-Control": "private, no-store" };

async function handle(request: Request, context: Context): Promise<NextResponse> {
  try {
    const { id } = await context.params;
    const denied = await raceResourceAccess(id);
    if (denied) return NextResponse.json({ error: denied === 401 ? "Authentication required" : "Race not found" }, { status: denied, headers: privateHeaders });
    if (request.method === "GET") {
      const [resource] = await db.select().from(raceResources).where(eq(raceResources.activityId, id));
      const attachments = await db.select({ id: raceAttachments.id, filename: raceAttachments.filename, contentType: raceAttachments.contentType, sizeBytes: raceAttachments.sizeBytes })
        .from(raceAttachments).where(eq(raceAttachments.activityId, id)).orderBy(raceAttachments.createdAt);
      return NextResponse.json({ resultsUrl: resource?.resultsUrl ?? null, attachments }, { headers: privateHeaders });
    }
    if (request.method === "PATCH") {
      let resultsUrl: string | null;
      try { resultsUrl = parseResultsUrl((await request.json()).resultsUrl); }
      catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid results URL" }, { status: 400 }); }
      await db.insert(raceResources).values({ activityId: id, resultsUrl }).onConflictDoUpdate({ target: raceResources.activityId, set: { resultsUrl } });
      return NextResponse.json({ resultsUrl }, { headers: privateHeaders });
    }
    // Bound the streamed multipart body as well as the file, including chunked requests.
    const reader = request.body?.getReader();
    if (!reader) return NextResponse.json({ error: "Choose a file" }, { status: 400 });
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_RACE_ATTACHMENT_BYTES + 64 * 1024) {
        await reader.cancel();
        return NextResponse.json({ error: "Choose a file up to 15 MB" }, { status: 413 });
      }
      chunks.push(value);
    }
    let file: File;
    let validated: { filename: string; contentType: string };
    let bytes: Buffer;
    try {
      const form = await new Request(request.url, { method: "POST", headers: { "Content-Type": request.headers.get("Content-Type") ?? "" }, body: Buffer.concat(chunks) }).formData();
      const entry = form.get("file");
      if (!entry || typeof entry === "string") throw new Error("Choose a file");
      file = entry;
      bytes = Buffer.from(await file.arrayBuffer());
      validated = validateRaceAttachment(file.name, bytes);
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid file" }, { status: 400 }); }
    const attachment = await db.transaction(async (tx) => {
      // Serialize uploads to this race so concurrent requests cannot exceed the cap.
      await tx.select({ id: runActivities.id }).from(runActivities).where(eq(runActivities.id, id)).for("update");
      const existing = await tx.select({ id: raceAttachments.id }).from(raceAttachments).where(eq(raceAttachments.activityId, id));
      if (existing.length >= MAX_RACE_ATTACHMENTS) return null;
      const [created] = await tx.insert(raceAttachments).values({ activityId: id, ...validated, sizeBytes: bytes.length, contentBase64: bytes.toString("base64") })
        .returning({ id: raceAttachments.id, filename: raceAttachments.filename, contentType: raceAttachments.contentType, sizeBytes: raceAttachments.sizeBytes });
      return created;
    });
    if (!attachment) return NextResponse.json({ error: "A race can have up to 10 attachments. Remove one before uploading another." }, { status: 409 });
    return NextResponse.json({ attachment }, { status: 201, headers: privateHeaders });
  } catch (error) {
    console.error("Race resources request failed:", error);
    return NextResponse.json({ error: "Unable to update race resources" }, { status: 500, headers: privateHeaders });
  }
}

export const GET = handle;
export const PATCH = handle;
export const POST = handle;
