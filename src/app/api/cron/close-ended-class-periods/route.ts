import { bearerMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report-error";
import { logActionAs } from "@/features/audit/server/log";
import { isMissingFunction } from "@/features/classes/server/period-enrollments";

/**
 * **운영 기간이 끝난 반**의 열린 수강을 그 운영 종료일로 닫는 cron(매일 00:35 KST — 전날로 끝난 기간을 자정 직후에).
 *
 * 원장 2026-09-18: *"종강 날짜가 있으면 학생들의 수강 종료일자를 자동으로 종강날짜로 지정할것. (새로 추가시에도, 기존 학생들도)"*
 * → 날짜는 반 수정의 '운영 기간'. 규칙은 SQL 한 벌(`close_ended_class_period_enrollments` → `class_period_closed_end`, 0274a).
 *
 * 🔴 **끝난 뒤에** 닫는다 — 미래 종료일을 미리 박으면 앱 26곳("종료일 비었음 = 수강 중")에서 그 수강이 빠진다(적대 리뷰
 *    2026-09-18: 그 사이 퇴원·휴원·반 폐지·공지 대상이 특강 수강을 놓친다). 끝나기 전엔 반 상세가 표시만 한다.
 * 🔴 감사로그는 반마다 한 줄 — 로그인한 사람이 없어 행위자는 문 이름(`logActionAs`)이다.
 * ⚠️ 0274a 미적용이면 아무것도 안 하고 그 사실만 돌려준다([[#95]]).
 */
export const dynamic = "force-dynamic";

const ACTOR = "시스템(운영 기간 종료)";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("close_ended_class_period_enrollments");
  if (error) {
    if (isMissingFunction(error)) return NextResponse.json({ ok: true, skipped: "0274a 미적용" });
    reportError(error, { where: "close-ended-class-periods" });
    return NextResponse.json({ ok: false, error: "운영 기간 종료 처리에 실패했습니다" }, { status: 500 });
  }

  const rows = (data ?? []) as {
    tenant_id: string;
    class_id: string;
    class_name: string;
    period_end: string;
    closed: number;
  }[];
  for (const r of rows) {
    await logActionAs(
      { tenantId: r.tenant_id, actorName: ACTOR },
      {
        action: "class_period_enrollments",
        targetType: "class",
        targetLabel: r.class_name,
        metadata: { classId: r.class_id, periodEnd: r.period_end, changed: r.closed },
      },
    );
  }
  if (rows.length > 0) {
    revalidatePath("/classes", "layout");
    revalidatePath("/students", "layout");
    revalidatePath("/attendance", "layout");
  }
  return NextResponse.json({ ok: true, classes: rows.length, closed: rows.reduce((a, r) => a + r.closed, 0) });
}
