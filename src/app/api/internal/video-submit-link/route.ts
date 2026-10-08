import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { authorizeInternalWorker } from "@/features/sync-agent/server/internal-auth";
import { reportSiteLine } from "@/features/video-submit/server/report-link";

/**
 * 발송 PC 워커 전용 — 수업보고서를 ClassNote에 올리기 직전, 이 보고서 글에 **올리기 사이트 안내 줄**을 붙일지 묻는다.
 * ⚠️ `x-eywa-internal` === `CLASSNOTE_INTERNAL_SECRET` 게이트(보고서 첨부·스크린샷과 같은 시크릿).
 * 응답 `{ token: null, site: boolean }` — `site: true`면 새 워커가 `영상첨부 : {공유 주소}/v` 한 줄을 붙인다(2026-10-03 원장
 * *"영상숙제 체크하더라도 /v 링크를 안내"*). 학생마다 링크(토큰)는 더 만들지 않는다 — `token`은 늘 null(옛 워커는 줄 없이 보낸다).
 * 🔴 실패도 `site: false`로 돌려준다: 이 경로가 보고서 발송을 막으면 안 된다.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const authorization = await authorizeInternalWorker(request.headers.get("x-eywa-internal"));
  if (!authorization)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { reportId?: unknown } | null;
  if (authorization.tenantId) {
    if (typeof body?.reportId !== "string") return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const { data } = await createAdminClient().from("lesson_reports").select("id").eq("id", body.reportId).eq("tenant_id", authorization.tenantId).maybeSingle();
    if (!data) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    return NextResponse.json({ token: null, site: await reportSiteLine(body?.reportId) });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", scope: "videoSubmit.reportSiteLine", message: error instanceof Error ? error.message : "unknown" }));
    return NextResponse.json({ token: null, site: false });
  }
}
