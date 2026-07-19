import "server-only";
/**
 * 결석 발송 게이트 — 서버 조회 헬퍼(#77 공용 게이트화). 판정 규칙은 순수 ../absence-gate.ts.
 * 소비처: saveAndQueueClassnote(강사) · saveAndQueueAdminReport/sendBulkAdminReports(관리자 직접·대량) ·
 * sendClassnoteForUnsent/retryClassnote(발송 콘솔) · detectUnsentReports(미발송 재촉 이벤트 — 게이트 동일 불변식).
 *
 * - lesson_reports엔 class_id가 없어 과목 매칭은 attendance_records.class_id → classes.subject 해석(2단계 조회).
 * - subject null 후보는 검사하지 않는다(과목 게이트가 이미 발송을 거부하는 행 — 여기선 항상 통과).
 * - tenantId 필수: admin(RLS 우회) 호출이 있어 테넌트 필터가 불변식(complete-notify와 동일).
 *   RLS 클라이언트에선 이중 방어(무해).
 * - 조회 실패는 throw(fetchInChunks 규약) — 호출부가 catch해 발송을 멈춘다(fail-closed, "모르면 안 보냄").
 * - ⚠️ 알려진 한계: 게이트는 **큐잉 시점** 판정 — 이미 queued인 행은 출결을 결석으로 사후 정정해도
 *   워커가 그대로 게시한다(킬스위치가 queued 재고를 못 막는 것과 동일한 구조 한계, classnote-integration.md §5).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { isAbsentForSend, type AbsenceGateRecord } from "../absence-gate";

/** 발송 후보 1건의 출결 판정 키 — 보고서 행과 동일 축(학생·날짜·과목). */
export type AbsenceKey = { studentId: string; reportDate: string; subject: string | null };

export function absenceKeyOf(key: AbsenceKey): string {
  return `${key.studentId}|${key.reportDate}|${key.subject ?? ""}`;
}

/** (학생, 날짜, 과목) 후보들 중 "그날 결석 기록이라 발송 차단"인 키 집합(absenceKeyOf 키). */
export async function getAbsenceBlockedKeys(
  supabase: SupabaseClient,
  tenantId: string,
  keys: readonly AbsenceKey[],
): Promise<Set<string>> {
  const usable = keys.filter((k) => k.subject);
  if (usable.length === 0) return new Set();
  const studentIds = [...new Set(usable.map((k) => k.studentId))];
  const dates = [...new Set(usable.map((k) => k.reportDate))];

  // 해당 날짜들의 출결 전건. ⚠️ 청크(학생 100명) × 다(多)날짜 교차곱은 1000행을 넘을 수 있어
  // (발송 콘솔 200건이 최대 ~2달 창에 흩어진 경우) 반드시 페이지네이션(B2/#54 — silent 절단이면
  // 결석 행이 잘려 게이트가 조용히 뚫린다). order("id") = OFFSET 안정용 unique tie-break.
  const records = await fetchAllPagedInChunks<{
    id: string;
    student_id: string;
    class_id: string;
    session_date: string;
    status: string;
    recorded_at: string;
  }>(studentIds, (chunk, from, to) =>
    supabase
      .from("attendance_records")
      .select("id, student_id, class_id, session_date, status, recorded_at")
      .eq("tenant_id", tenantId)
      .in("session_date", dates)
      .in("student_id", chunk)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (records.length === 0) return new Set();

  // 반 → 과목 해석(FK 임베드 이름 추측 회피 — compose-actions 2단계 조회 패턴).
  const classIds = [...new Set(records.map((r) => r.class_id))];
  const classes = await fetchInChunks<{ id: string; subject: string | null }>(classIds, (chunk) =>
    supabase.from("classes").select("id, subject").eq("tenant_id", tenantId).in("id", chunk),
  );
  const subjectByClass = new Map(classes.map((c) => [c.id, c.subject]));

  // (학생|날짜|과목)별 레코드 묶음 → 순수 판정.
  const byKey = new Map<string, AbsenceGateRecord[]>();
  for (const rec of records) {
    const subject = subjectByClass.get(rec.class_id);
    if (!subject) continue;
    const key = `${rec.student_id}|${rec.session_date.slice(0, 10)}|${subject}`;
    const gateRec = { classId: rec.class_id, status: rec.status, recordedAt: rec.recorded_at, id: rec.id };
    const list = byKey.get(key);
    if (list) list.push(gateRec);
    else byKey.set(key, [gateRec]);
  }
  const blocked = new Set<string>();
  for (const k of usable) {
    const id = absenceKeyOf(k);
    const list = byKey.get(id);
    if (list && isAbsentForSend(list)) blocked.add(id);
  }
  return blocked;
}

/** 단건 편의 래퍼 — 개별 발송 액션용. */
export async function isStudentAbsentForSend(
  supabase: SupabaseClient,
  tenantId: string,
  key: AbsenceKey,
): Promise<boolean> {
  const blocked = await getAbsenceBlockedKeys(supabase, tenantId, [key]);
  return blocked.has(absenceKeyOf(key));
}
