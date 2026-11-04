import "server-only";
import { createClient } from "@/lib/supabase/server";
import { logDbError } from "@/lib/supabase/db-error";
import { recentSentWindow } from "../report-optout-warning";

/**
 * 이 반이 최근 30일(오늘 포함) 동안 ClassNote로 보낸 수업보고서 건수 — '수업보고서 미발송'을 켜기 전 경고용
 * (report-optout-warning.ts · 2026-11-04 사고).
 *
 * · 🔴 행을 받지 않는다(B2) — `count: "exact", head: true`. 색인 `lesson_reports_class_date_idx (tenant_id, class_id, report_date)`.
 * · 지점 격리는 RLS(`lesson_reports_tenant_isolation`)가 한다 — 사용자 클라이언트로 센다(강사가 연 자기 반 화면도 같은 값).
 * · "보냈다" = `classnote_status = 'success'`(ClassNote 게시 완료). 반은 `class_id`(그 반 정규 보고서)로 본다.
 * · 못 세면 null — 화면은 "확인하지 못했습니다"로 **그래도 경고한다**. 🔴 throw하지 않는다: 편집 화면의
 *   `Promise.all`에 함께 걸려 있어서, 경고용 조회 하나가 실패해 반 수정 화면 전체가 안 열리면 안 된다.
 */
export async function countRecentSentReports(classId: string, today: string): Promise<number | null> {
  const { from, to } = recentSentWindow(today);
  try {
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("lesson_reports")
      .select("id", { count: "exact", head: true })
      .eq("class_id", classId)
      .eq("classnote_status", "success")
      .gte("report_date", from)
      .lte("report_date", to);
    if (error) {
      logDbError(error, "classes.countRecentSentReports", { classId });
      return null;
    }
    return typeof count === "number" ? count : null;
  } catch (error) {
    logDbError(error, "classes.countRecentSentReports", { classId });
    return null;
  }
}
