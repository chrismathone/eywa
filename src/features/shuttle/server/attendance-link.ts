import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { getBoardingsOn } from "./queries";
import { missedSignals } from "../roster";

/**
 * 셔틀 ↔ 출결 연동 — 🔴 **신호만, 자동 쓰기 없음**(원장 2026-08-19).
 *
 * 두 방향 다 "화면에서 서로를 보여줄 뿐" 상대 표를 쓰지 않는다:
 *  · 셔틀 → 출결 : 그날 셔틀 미탑승 학생을 오늘 출결 위에 띠로 보여준다(결석을 만들지 않는다).
 *  · 출결 → 셔틀 : 그날 결석 처리된 학생을 셔틀 명단에서 표시한다(배정을 지우지 않는다).
 *
 * 자동 쓰기를 안 하는 이유는 두 사실이 **다른 사실**이기 때문이다 — 부모가 직접 데려오면 셔틀은
 * 미탑승인데 출석이고, 셔틀은 탔는데 교실에 안 들어오는 경우도 있다. 게다가 강사 소급 퇴원 사고
 * 이후 "자동으로 학생 기록을 바꾸는 경로"는 만들지 않는 것이 이 프로젝트의 결정이다(CLAUDE.md).
 *
 * ⚠️ 둘 다 **부가 정보**라 실패해도 본 화면을 죽이지 않는다. 단 조용히 접으면 "신호가 안 뜬다"를
 *    아무도 모르므로([[#89]]) 계측은 남긴다.
 */

export type ShuttleMissedRow = {
  studentId: string;
  studentName: string;
  /** "1호차 3회차 등원" — 사람이 읽는 문구(raw 코드 노출 금지). */
  where: string;
  reason: string | null;
};

/** 출결 화면 상단 띠용 — 그날 셔틀 미탑승 학생 + 사유. */
export async function getShuttleMissedForAttendance(ymd: string): Promise<ShuttleMissedRow[]> {
  try {
    const { ready, logs } = await getBoardingsOn(ymd);
    if (!ready) return [];
    const signals = missedSignals(logs);
    if (signals.length === 0) return [];

    const user = await getCurrentUser();
    if (!user) return [];
    const supabase = await createClient();
    const rows = await fetchInChunks<{ id: string; name: string }>(
      signals.map((s) => s.studentId),
      (chunk) => supabase.from("students").select("id, name").in("id", chunk),
    );
    const nameById = new Map(rows.map((r) => [r.id, r.name]));

    return signals.map((s) => ({
      studentId: s.studentId,
      studentName: nameById.get(s.studentId) ?? "(이름 없음)",
      where: s.where,
      reason: s.reason,
    }));
  } catch (e) {
    reportError(e, { scope: "shuttle.missedForAttendance", ymd });
    return [];
  }
}

/**
 * 셔틀 일별 화면용 — 그날 **결석/휴가 처리된 학생 id**. 셔틀 줄 옆에 "오늘 결석" 표시를 붙여
 * 데스크가 헛되이 기다리지 않게 한다.
 *
 * ⚠️ `late`·`early_leave`는 제외한다 — 지각·조퇴는 셔틀을 타긴 탄 것이라 신호가 되면 소음이다.
 */
export async function getAbsentStudentIdsOn(ymd: string): Promise<Set<string>> {
  try {
    const user = await getCurrentUser();
    if (!user) return new Set();
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("attendance_records")
      .select("student_id")
      .eq("session_date", ymd)
      .in("status", ["absent", "excused"])
      .limit(2000); // 하루 결석은 수십 건 규모 — 절단 방지 명시 상한(B2)
    if (error) {
      reportError(error, { scope: "shuttle.absentIds", ymd });
      return new Set();
    }
    return new Set((data ?? []).map((r) => r.student_id as string));
  } catch (e) {
    reportError(e, { scope: "shuttle.absentIds", ymd });
    return new Set();
  }
}
