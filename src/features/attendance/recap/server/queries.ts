import "server-only";
import { cache } from "react";
/**
 * 어제 출결 요약 — 적재. 화면(요약 탭)과 AI 정리가 **같은 결과**를 쓴다.
 *
 * 🔑 보드는 새로 적재하지 않고 `getLiveBoard(date)`를 그대로 쓴다(React cache라 같은 요청 안에서
 *    좌석표·큐와 왕복을 공유한다). 요약을 위해 별도 집계 쿼리를 새로 짜면 "좌석표엔 12명인데 요약엔
 *    14명" 같은 어긋남이 생긴다 — 당일 출결이 이미 한 적재로 두 면을 그리는 이유와 같다.
 * ⚠️ 휴원일은 보드가 비어 있으므로 요약도 자동으로 빈다(호출부가 휴원일 안내를 먼저 그린다).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { reportError } from "@/lib/observability/report-error";
import { getLiveBoard, loadFollowups } from "@/features/attendance/live/server/queries";
import { buildDayRecap, type DayRecap, type RecapFollowup, type RecapSlotInput } from "../digest";
import type { RecapBrief } from "../prompt";

/** 반복 결석으로 볼 문턱 — 이 미만은 표시하지 않는다(첫 결석에 "1회"를 붙이면 노이즈다). */
const REPEAT_MIN = 2;

/**
 * 그날 요약(결정론). 관리자(full) 전용 — 이 화면은 전 학원 학생의 결석 사유·담당까지 한 장에 모은다.
 *
 * @returns 권한이 없으면 null(호출부가 탭 자체를 안 그린다).
 */
export const getDayRecap = cache(async (date: string): Promise<DayRecap | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  if ((await accessLevelTenant(user.systemRole, "attendance")) !== "full") return null;

  // 서로 독립인 조회 3종(B4). 보드는 cache라 이미 받아둔 요청에선 왕복이 없다.
  const [board, followups, repeats] = await Promise.all([
    getLiveBoard(date),
    loadFollowups(date),
    loadRepeatAbsences(),
  ]);

  const slots: RecapSlotInput[] = board.teachers.flatMap((teacher) =>
    teacher.slots.map((slot) => ({
      classId: slot.classId,
      className: slot.className,
      subject: slot.subject,
      slotStart: slot.slotStart,
      saveSlot: slot.saveSlot,
      teacherName: teacher.teacherName,
      slotTeacherLabel: slot.slotTeacherLabel,
      hasAnyRecord: slot.hasAnyRecord,
      students: slot.students.map((s) => ({
        studentId: s.studentId,
        studentName: s.studentName,
        schoolGrade: s.schoolGrade,
        status: s.status,
        // ⚠️ 연락처는 싣지 않는다 — 요약은 "무슨 일이 있었나"를 읽는 화면이고, 전화는 데스크 큐가 한다.
        note: s.note,
      })),
    })),
  );

  return buildDayRecap({
    date,
    slots,
    followupOf: (studentId, saveSlot) => {
      const hit = followups.get(`${studentId}|${saveSlot ?? ""}`) ?? followups.get(`${studentId}|`) ?? null;
      return hit ? ({ state: hit.state, outcome: hit.outcome, handledByName: hit.handledByName } as RecapFollowup) : null;
    },
    recentAbsenceOf: (studentId) => repeats.get(studentId) ?? null,
  });
});

/**
 * 최근 14일 반복 결석(학생 → 회수) — 위험 명단·마일스톤 알림과 **같은 RPC**를 쓴다.
 * 🔑 셈 단위가 (반·날짜)라 영어 연강이 3회로 부풀지 않는다(0221a). 여기서 규칙을 다시 짜지 말 것.
 * ⚠️ 창은 **오늘 기준 14일**이다(0220a). 요약 날짜가 오래 전이면 이 값은 "지금 기준"이라 화면도 그렇게 적는다.
 * ⚠️ 실패해도 요약은 살린다 — 반복 결석 표식이 없을 뿐이고, 조용히 넘기지는 않는다(#89).
 */
async function loadRepeatAbsences(): Promise<Map<string, number>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("dashboard_absence_risk", { p_min: REPEAT_MIN });
  if (error) {
    reportError(error, { scope: "attendance.recap.repeatAbsences" });
    return new Map();
  }
  return new Map(
    ((data as { student_id: string; absences: number }[] | null) ?? []).map((r) => [
      r.student_id,
      Number(r.absences),
    ]),
  );
}

export type SavedRecapBrief = {
  status: string; // idle | analyzing | completed | failed
  brief: RecapBrief | null;
  error: string | null;
  model: string | null;
  generatedAt: string | null;
};

/**
 * 저장된 AI 정리 — **페이지 로드는 절대 생성하지 않는다**(CLAUDE.md AI 정책). 마지막 결과를 그대로 보인다.
 *
 * ⚠️ 표(0226a)가 아직 적용 전이어도 화면은 살아야 한다(#95: 앱은 옛 스키마·새 스키마 둘 다에서 돈다) →
 *    조회 실패는 null로 떨어뜨리고 카드가 '정리 없음'으로 뜬다. 로그에는 남긴다.
 * ⚠️ 이 표엔 RLS 정책이 없다(0114a 브리핑과 같은 취지) → admin 클라이언트 + **tenant_id 명시 필터**([[#104]]).
 */
export async function getSavedRecapBrief(date: string): Promise<SavedRecapBrief | null> {
  // 🔴 게이트를 여기서도 건다 — admin 클라이언트는 RLS를 우회하므로, 이 함수가 나중에 다른 화면에서
  //    불리는 순간 "호출부가 막아주겠지"는 게이트가 아니다(#77).
  // 🔴 테넌트도 **인자로 받지 않는다** — 세션의 테넌트만 읽는다(잘못된 id를 넘길 여지 자체를 없앤다).
  const user = await getCurrentUser();
  if (!user) return null;
  if ((await accessLevelTenant(user.systemRole, "attendance")) !== "full") return null;
  const tenantId = user.tenantId;
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("attendance_day_recaps")
    .select("status, summary, error, model_version, generated_at")
    .eq("tenant_id", tenantId)
    .eq("recap_date", date)
    .maybeSingle();
  if (error) {
    reportError(error, { scope: "attendance.recap.savedBrief", date });
    return null;
  }
  if (!data) return null;
  return {
    status: (data.status as string) ?? "idle",
    brief: (data.summary as RecapBrief | null) ?? null,
    error: (data.error as string | null) ?? null,
    model: (data.model_version as string | null) ?? null,
    generatedAt: (data.generated_at as string | null) ?? null,
  };
}
