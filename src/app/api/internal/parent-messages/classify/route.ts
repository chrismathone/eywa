import { authorizeInternalWorker } from "@/features/sync-agent/server/internal-auth";
import { NextResponse } from "next/server";
import { classifyPendingParentMessages } from "@/features/attendance/parent-alerts/server/classify";
import { judgeParentSatisfaction } from "@/features/teacher-portfolio/server/satisfaction-judge";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportWarning } from "@/lib/observability/report-error";

/**
 * ClassNote 인바운드 워커 전용 — 방금 저장한 학부모 연락의 **출결 의도 분류 킥**.
 *
 * 워커(연동 PC)는 원문만 `classnote_parent_messages`에 넣고 이 라우트를 두드린다. 분류(AI)를 앱이 하는 이유:
 *  ① 모든 AI(JSON) 호출은 `generateJSON()` 단일 진입점을 거쳐야 한다(CLAUDE.md) — 그건 앱 코드다.
 *  ② 연동 PC에 AI API 키를 두지 않는다.
 *
 * ⚠️ 게이트: `x-eywa-internal` === `CLASSNOTE_INTERNAL_SECRET`(워커 스샷·첨부 라우트와 동일 시크릿).
 * ⚠️ **실패해도 유실되지 않는다** — 분류 못 한 행은 미분류로 남아 다음 폴의 킥에서 다시 잡힌다.
 *    그래서 워커는 이 응답을 기다리되 실패를 치명으로 다루지 않는다(best-effort).
 * ⚠️ 이 라우트는 **AI를 실제로 호출**한다 → 페이지에서 부르지 말 것(명시 트리거 원칙).
 */
export const dynamic = "force-dynamic";
// ⚠️ 60초로는 모자란다 — 한 번에 최대 60건을 12건씩 5묶음으로 AI 판정 모델에
// 물어보므로 60초를 넘길 수 있고, 넘으면 함수가 **중간에 죽는다**. 행 단위로 즉시 저장하므로 죽어도
// 진행분은 남고 나머지는 다음 킥이 이어받지만, 굳이 반복해서 죽일 이유가 없다.
export const maxDuration = 300;

export async function POST(request: Request) {
  const worker = await authorizeInternalWorker(request.headers.get("x-eywa-internal"));
  if (!worker) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await classifyPendingParentMessages(worker.tenantId ?? undefined);
    // 강사평가 학부모 만족도 — 출결 연락이 아닌 글을 판정한다(같은 킥 = 명시 트리거). 실패해도 출결 분류 응답은 그대로(따로 다음 킥이 잇는다).
    const satisfaction = await judgeParentSatisfaction(createAdminClient(), worker.tenantId ?? undefined).catch((e: unknown) => {
      reportWarning("학부모 만족도 판정 실패", { scope: "parent-messages/classify", message: e instanceof Error ? e.message : String(e) });
      return null;
    });
    return NextResponse.json({ ok: true, ...result, satisfaction });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: worker.tenantId ? "classification_failed" : message }, { status: 500 });
  }
}
