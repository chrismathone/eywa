import "server-only";

import { createClient } from "@/lib/supabase/server";
import { endScopeFor, lastCourseGateApplies, viaReportMessage } from "@/features/withdrawals/via-report";
import { loadEndRows } from "@/features/withdrawals/server/via-report";
import type { EndScopeResult } from "../lib/end-scope-text";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 수강 한 건을 그 날짜로 끝내면 **무엇이 되는지**(이 반만 종강 / 그 과목 수강종료 / 퇴원) — 시간표 확인 팝업용.
 *
 * 그 학생의 **다른 수강 전부**(과목 불문)를 읽어 [`endScopeFor`](@/features/withdrawals/via-report)에 넘긴다.
 * 화면이 가진 데이터로는 못 정한다 — 시간표는 **보고 있는 과목·그 주 배치**만 들고 있어서, 다른 과목 반이나 그 주에
 * 배치가 없는 같은 과목 반을 모른다(모르는 채 '퇴원'이라 말하면 그게 이번에 고치는 거짓이다).
 * 🔑 마지막 반 종료를 막는 서버 게이트([`lastCourseViaReport`](@/features/withdrawals/server/via-report))와 **같은 조회·같은 판정**이다
 * (원장 2026-10-23 퇴원은 퇴원보고서로만 · 2026-10-26 그 과목의 마지막 반도) — 팝업이 '퇴원보고서로'라 말한 것(`viaReport`)만 서버가 막는다.
 *
 * 🔴 **모르면 null**(팝업은 중립 문구) — 반 하나라도 과목을 못 읽으면 판정하지 않는다(빠진 반 때문에 '퇴원'이라
 *    말하는 것이 문구가 없는 것보다 나쁘다).
 * ⚠️ 세션 클라이언트(RLS) — 호출부(라우트)가 원생 상태 변경 권한을 먼저 본다.
 */
export async function loadEndScope(input: {
  enrollmentId: string;
  date: string;
}): Promise<EndScopeResult | null> {
  const { enrollmentId, date } = input;
  if (!enrollmentId || !YMD_RE.test(date)) return null;
  try {
    const supabase = await createClient();
    const { data: row, error } = await supabase
      .from("enrollments")
      .select("id, student_id")
      .eq("id", enrollmentId)
      .maybeSingle();
    if (error) {
      console.error("[timetable] 수강 종료 범위 — 수강 행 조회 실패", error);
      return null;
    }
    if (!row) return null;
    const { status, withdrawnAt, rows } = await loadEndRows(supabase, row.student_id as string);
    const target = rows.find((r) => r.id === enrollmentId);
    if (!target) return null;
    const res = endScopeFor(rows, target, new Set([enrollmentId]), date, withdrawnAt);
    const gate = lastCourseGateApplies(status, withdrawnAt);
    // 서버가 막지 않는 학생(이미 퇴원·예비·상담 · 예전 퇴원 예약)에게 '퇴원보고서로' 문구를 띄우지 않는다 — 중립 문구로.
    if (res.scope === "student" && !gate) return null;
    // 서버 게이트와 **같은 판정**(`viaReportMessage`) — 과목 마지막 반(원장 2026-10-26)도 서버가 막는 것만 '퇴원보고서로'라 말한다.
    const viaReport = gate && viaReportMessage(rows, [enrollmentId], date, withdrawnAt) !== null;
    return { scope: res.scope, otherClassName: res.other?.className ?? null, transfer: res.transfer, viaReport };
  } catch (e) {
    console.error("[timetable] 수강 종료 범위 판정 실패", e);
    return null;
  }
}
