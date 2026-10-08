import { recordUploadEvent } from "@/features/video-submit/server/upload-diagnostics";
import { uploadOrigin } from "@/features/video-submit/upload-checks";

export const dynamic = "force-dynamic";
/** A small, authenticated diagnostic event. Failure here must never affect a video upload. */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store", "Retry-After": "60" };
  if (!uploadOrigin(request.headers.get("origin"), new URL(request.url).host)) return new Response(null, { status: 403, headers });
  if (!request.body || Number(request.headers.get("content-length") ?? 0) > 4096) return new Response(null, { status: 413, headers });
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > 4096) { await reader.cancel(); return new Response(null, { status: 413, headers }); }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body = JSON.parse(new TextDecoder().decode(bytes)) as { token?: unknown; uploadId?: unknown; event?: unknown } | null;
    const status = await recordUploadEvent({ token: body?.token, uploadId: body?.uploadId, event: body?.event });
    return new Response(null, { status, headers });
  } catch { return new Response(null, { status: 400, headers }); }
  finally { reader.releaseLock(); }
}
