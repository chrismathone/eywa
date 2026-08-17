import "server-only";
/**
 * 결석 발송 게이트 — 서버 조회 헬퍼(#77 공용 게이트화). 판정 규칙은 순수 ../absence-gate.ts.
 * 소비처: saveAndQueueClassnote(강사) · saveAndQueueAdminReport/sendBulkAdminReports(관리자 직접·대량) ·
 * sendClassnoteForUnsent/retryClassnote(발송 콘솔) · detectUnsentReports(미발송 재촉 이벤트 — 게이트 동일 불변식).
 *
 * - **반(classId)이 주어지면 그 반 출결만** 본다(0134a). 예전엔 lesson_reports에 class_id가 없어
 *   과목 단위로만 볼 수 있었는데, 같은 과목 두 반(정규 수학 + 수학 특강)이 생기면서 그게 틀리기 시작했다:
 *   "전부 결석일 때만 차단" 규칙 때문에 **특강에 결석해도 정규에 출석했으면 특강 보고서가 나갔다.**
 *   반이 없는 후보(이관·보강·관리자 작성)는 예전대로 과목 단위(그 과목 반들 전부 결석일 때만 차단).
 * - subject·classId가 둘 다 없는 후보는 검사하지 않는다(과목 게이트가 이미 발송을 거부하는 행).
 * - tenantId 필수: admin(RLS 우회) 호출이 있어 테넌트 필터가 불변식(complete-notify와 동일).
 *   RLS 클라이언트에선 이중 방어(무해).
 * - 조회 실패는 throw(fetchInChunks 규약) — 호출부가 catch해 발송을 멈춘다(fail-closed, "모르면 안 보냄").
 * - ⚠️ 알려진 한계: 게이트는 **큐잉 시점** 판정 — 이미 queued인 행은 출결을 결석으로 사후 정정해도
 *   워커가 그대로 게시한다(킬스위치가 queued 재고를 못 막는 것과 동일한 구조 한계, classnote-integration.md §5).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { isAbsentForSend, type AbsenceGateRecord } from "../absence-gate";

/**
 * 발송 후보 1건의 출결 판정 키 — 보고서 행과 **동일 축**(학생·날짜·반, 반이 없으면 과목).
 * 0134a에서 보고서 단위가 반이 됐으므로 이 게이트의 축도 같이 반으로 내려간다.
 */
export type AbsenceKey = {
  studentId: string;
  reportDate: string;
  subject: string | null;
  /** 이 보고서의 반. 있으면 **그 반 출결만** 본다(없으면 과목 단위 — 예전 동작). */
  classId?: string | null;
};

export function absenceKeyOf(key: AbsenceKey): string {
  // 반 키와 과목 키가 절대 섞이지 않도록 접두를 붙인다(uuid와 과목키가 우연히 같을 일은 없지만 명시).
  const unit = key.classId ? `c:${key.classId}` : `s:${key.subject ?? ""}`;
  return `${key.studentId}|${key.reportDate}|${unit}`;
}

/** 후보들 중 "그날 결석 기록이라 발송 차단"인 키 집합(absenceKeyOf 키). */
export async function getAbsenceBlockedKeys(
  supabase: SupabaseClient,
  tenantId: string,
  keys: readonly AbsenceKey[],
): Promise<Set<string>> {
  const usable = keys.filter((k) => k.classId || k.subject);
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

  // 레코드를 **두 축으로** 묶는다 — 반 단위 후보는 그 반 기록만, 과목 단위 후보는 그 과목 반 전체를 본다.
  // (같은 records를 두 번 색인하는 것뿐 — 추가 조회 없음.)
  const byKey = new Map<string, AbsenceGateRecord[]>();
  const push = (key: string, rec: AbsenceGateRecord) => {
    const list = byKey.get(key);
    if (list) list.push(rec);
    else byKey.set(key, [rec]);
  };
  for (const rec of records) {
    const date = rec.session_date.slice(0, 10);
    const gateRec = { classId: rec.class_id, status: rec.status, recordedAt: rec.recorded_at, id: rec.id };
    push(`${rec.student_id}|${date}|c:${rec.class_id}`, gateRec);
    const subject = subjectByClass.get(rec.class_id);
    if (subject) push(`${rec.student_id}|${date}|s:${subject}`, gateRec);
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

/**
 * 그날 그 반에 이 학생의 출결 기록이 **하나라도** 있는가 — 출결 미체크 발송 게이트(2026-08-17 원장 지시)의
 * 서버 판정. 출결 체크도 진도·멘트 같은 "발송에 필요한 입력"이 됐다.
 *
 * ⚠️ 위 결석 게이트(fail-open: 기록 없음=통과)를 뒤집지 않고 **별도 체크**로 둔 이유 — 그 fail-open은
 *    발송 콘솔·재발송·관리자 대량·미발송 재촉 이벤트가 공유하는 규약이라, 뒤집으면 출결 기록이 아예 없는
 *    이관(edutrix)·과거 건의 관리자 구제 발송이 영영 막힌다(#105 — 구제 경로를 막으면 학부모에게 영영 못 감).
 *    이 체크는 **강사 발송 경로(saveAndQueueClassnote)만** 소비한다. 미발송 재촉 이벤트(detectUnsentReports)는
 *    발송 콘솔(관리자 경로) 게이트를 미러하므로 여기 안 걸려도 거짓 재촉이 아니다(#77 불변식 유지).
 * ⚠️ attendance_records RLS = tenant_isolation(0001a, authenticated 전원) — 강사 세션 클라이언트로도
 *    0행 침묵(#104) 없이 읽힌다(결석 게이트와 같은 클라이언트·같은 표).
 * count head:true = 행을 받지 않는 존재 확인(B2). 조회 실패는 throw — 호출부가 catch해 발송을 멈춘다
 * (fail-closed, "모르면 안 보냄" — 결석 게이트와 동일 계약).
 */
export async function hasAnyAttendance(
  supabase: SupabaseClient,
  tenantId: string,
  key: { studentId: string; classId: string; date: string },
): Promise<boolean> {
  const { count, error } = await supabase
    .from("attendance_records")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("student_id", key.studentId)
    .eq("class_id", key.classId)
    .eq("session_date", key.date);
  if (error) throw new Error(error.message);
  return (count ?? 0) > 0;
}
