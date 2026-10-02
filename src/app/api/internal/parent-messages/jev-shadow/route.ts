import { secretMatches } from "@/lib/http/secret-compare";
import { compareParentMessageWithJev, shadowRequestSchema, ShadowError } from "@/features/attendance/parent-alerts/server/jev-shadow";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/** Manual comparison only. No queue kick, classification update or notification side effect. */
export async function POST(request: Request) {
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  if (!secretMatches(request.headers.get("x-eywa-internal"), process.env.CLASSNOTE_INTERNAL_SECRET)) {
    return json({ error: "unauthorized" }, 401);
  }
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const parsed = shadowRequestSchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);
  try {
    return json({ ok: true, ...await compareParentMessageWithJev(parsed.data) });
  } catch (error) {
    if (error instanceof ShadowError) return json({ ok: false, error: error.message }, error.status);
    // Never echo raw provider or database errors to the API caller.
    return json({ ok: false, error: "Jev 비교 실패 — 기존 출결 판정은 변경되지 않았습니다" }, 502);
  }
}
