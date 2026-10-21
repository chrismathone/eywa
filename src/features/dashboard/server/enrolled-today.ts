import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { kstDateOf, kstTimeOf } from "@/lib/date-kst";
import { auditScoped, systemAuditScope } from "@/features/audit/server/system-read";
import { countAssignedClasses } from "@/features/enrollment/server/assigned-classes";
import { kstDayBounds } from "@/features/enrollment/kst-bounds";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { enrolledRecentFrom } from "@/features/dashboard/overview/enrolled-recent";

export type EnrolledTodayRow = {
  /** 콜&상담 id. */
  id: string;
  name: string;
  schoolGrade: string | null;
  /** 등록 완료로 옮긴 날(KST YYYY-MM-DD) — 창 안에서 마지막으로 옮긴 날. 어제·이번 달을 이 값으로 가른다. */
  date: string | null;
  /** 등록 완료로 옮긴 시각(KST HH:MM) — 창 안에서 마지막으로 옮긴 때. */
  time: string | null;
  /** 칸반 '반 배정 완료'와 같은 판정(`countAssignedClasses`). */
  assigned: boolean;
  /** 상담 과목 키(안 골랐으면 null) — 과목 관리자 카드가 담당 과목으로 거른다. */
  subject: string | null;
};

type OutcomeLog = { metadata: { consultationId?: unknown; to?: unknown } | null; created_at: string };

/**
 * 운영실 KPI **'전일 / 이달 신규'**(원장 2026-09-23 '금일 등록' → 2026-10-21 *"전일 신규생 및 / 이달의 신규생 다나오는걸로"*) —
 * **어제부터 오늘까지 · 이번 달**(`enrolledRecentFrom`) 콜&상담 상태를 '등록 완료'(outcome=enrolled)로 옮긴 상담.
 * 카드 숫자와 팝업이 **같은 배열**이고, 어제·이번 달 가르기는 `splitEnrolledRecent` 하나다.
 *
 * 🔑 옮긴 시각은 컬럼이 없어 **상태 변경 감사로그**(`enrollment_consultation_outcome`, to=enrolled)에서 읽는다 —
 *    칸반 드래그·상세 '상태 변경'(`setEnrollmentOutcome`)과 '수업 배정'(상담→원생 전환)이 둘 다 이 로그를 남긴다.
 * 🔴 **지금도 등록 완료인 상담만** 센다(오늘 옮겼다가 '미등록'으로 되돌린 건은 빠진다).
 * 🔴 반 배정 여부는 칸반 카드 표식과 **같은 함수**(`countAssignedClasses`) — 갈리면 카드와 칸반이 다른 말을 한다.
 */
export async function getEnrolledRecent(today: string): Promise<EnrolledTodayRow[]> {
  const scope = await systemAuditScope(["enrollment_consultation_outcome"]);
  if (!scope) return [];
  const { startIso } = kstDayBounds(enrolledRecentFrom(today));
  const { endIso } = kstDayBounds(today);
  const logs = await fetchAllPaged<OutcomeLog>((from, to) =>
    auditScoped(scope.admin.from("audit_logs").select("metadata, created_at"), scope)
      .eq("metadata->>to", "enrolled")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at")
      .order("id")
      .range(from, to),
  );
  // 상담마다 창 안에서 **마지막으로** 등록 완료로 옮긴 시각(같은 상담을 두 번 옮겨도 한 줄).
  const movedAt = new Map<string, string>();
  for (const log of logs) {
    const id = log.metadata?.consultationId;
    if (typeof id === "string" && log.metadata?.to === "enrolled") movedAt.set(id, log.created_at);
  }
  if (movedAt.size === 0) return [];

  const db = await createClient();
  type Row = {
    id: string;
    prospect_name: string | null;
    prospect_school: string | null;
    prospect_grade: string | null;
    subject: string | null;
    student_id: string | null;
    outcome: string;
  };
  const rows = await fetchInChunks<Row>([...movedAt.keys()], (chunk) =>
    db
      .from("enrollment_consultations")
      .select("id, prospect_name, prospect_school, prospect_grade, subject, student_id, outcome")
      .in("id", chunk),
  );
  const current = rows.filter((row) => row.outcome === "enrolled");
  const assigned = await Promise.all(
    current.map((row) => countAssignedClasses(db, row.student_id, row.subject || null)),
  );
  // 최근에 옮긴 것부터(신규문의 팝업과 같은 방향).
  const at = (id: string) => movedAt.get(id) ?? "";
  return current
    .map((row, i) => ({
      id: row.id,
      name: row.prospect_name?.trim() || "(이름 미상)",
      schoolGrade: schoolGradeLabel(row.prospect_school, row.prospect_grade) || null,
      date: kstDateOf(movedAt.get(row.id)),
      time: kstTimeOf(movedAt.get(row.id)),
      assigned: assigned[i] > 0,
      subject: row.subject || null,
    }))
    .sort((a, b) => at(b.id).localeCompare(at(a.id)) || a.id.localeCompare(b.id));
}
