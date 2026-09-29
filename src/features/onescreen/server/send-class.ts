import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { isSpecialLecture } from "@/features/classes/special-lecture";
import { pickMainClass } from "../send-class";

export type SendClassResolution =
  | { ok: true; classId: string }
  | { ok: false; reason: "choose" | "none"; candidates: { id: string; name: string }[] };

/**
 * 반 정보 없는 보강 보고서의 'ClassNote로 보낼 반'을 정한다(A안, 원장 2026-09-29).
 *
 * 후보 = 그날 그 학생이 다니는 반 중 **반 보드 대상**(수학 · 활성 · 보고서 발송 · 특강 아님 · 종강 전)이면서
 * ClassNote 반 보드 연결(0302a)이 있는 반. `chosen`이 오면 후보 안에 있을 때만 받는다(화면 위조 차단).
 * 안 오면 메인 수업(send-class.ts `pickMainClass`) — 정할 수 없으면 `choose`로 후보를 돌려준다.
 *
 * ⚠️ admin 클라이언트 + tenant 필터 — 강사 RLS로는 **다른 강사 반**의 보고서·출결 수가 안 보여 메인 수업을 잘못 고른다.
 *    돌려주는 것은 그 학생의 반 이름뿐이다(보고서·출결 내용은 안 나간다).
 * ⚠️ 발송 경로에서만 돈다(반별 경로 대상 보강 보고서) — 페이지 렌더에는 안 얹힌다.
 */
export async function resolveSendClass(
  tenantId: string,
  studentId: string,
  reportDate: string,
  chosen?: string | null,
): Promise<SendClassResolution> {
  const admin = createAdminClient();
  const { data: enr, error: enrErr } = await admin
    .from("enrollments")
    .select("class_id, start_date, end_date")
    .eq("tenant_id", tenantId)
    .eq("student_id", studentId);
  if (enrErr) throw new Error(enrErr.message);
  const live = [
    ...new Set(
      (enr ?? [])
        .filter((e) => (!e.start_date || e.start_date <= reportDate) && (!e.end_date || e.end_date >= reportDate))
        .map((e) => e.class_id as string),
    ),
  ];
  if (!live.length) return { ok: false, reason: "none", candidates: [] };

  const [{ data: cls, error: clsErr }, { data: boards, error: bErr }] = await Promise.all([
    admin
      .from("classes")
      .select("id, class_name, is_special, closed_at, subject, is_active, report_optout")
      .eq("tenant_id", tenantId)
      .in("id", live),
    admin.from("classnote_class_boards").select("class_id").eq("tenant_id", tenantId).in("class_id", live),
  ]);
  if (clsErr) throw new Error(clsErr.message);
  if (bErr) throw new Error(bErr.message);
  const hasBoard = new Set((boards ?? []).map((b) => b.class_id as string));
  const candidates = (cls ?? [])
    .filter((c) => (c.subject === "math" || c.subject === "subject_1") && c.is_active && !c.report_optout)
    .filter((c) => !isSpecialLecture({ isSpecial: c.is_special, className: c.class_name }))
    .filter((c) => !c.closed_at || c.closed_at >= reportDate)
    .filter((c) => hasBoard.has(c.id as string))
    .map((c) => ({ id: c.id as string, name: c.class_name as string }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  if (!candidates.length) return { ok: false, reason: "none", candidates: [] };

  if (chosen) {
    return candidates.some((c) => c.id === chosen)
      ? { ok: true, classId: chosen }
      : { ok: false, reason: "choose", candidates };
  }

  const ids = candidates.map((c) => c.id);
  const count = async (table: "lesson_reports" | "attendance_records", classId: string) => {
    let q = admin
      .from(table)
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("student_id", studentId)
      .eq("class_id", classId);
    if (table === "lesson_reports") q = q.eq("classnote_status", "success");
    const { count: n, error } = await q;
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  // 반 수(1~3) × 2 — 서로 독립이라 한 번에(B4).
  const [sentArr, attArr] = await Promise.all([
    Promise.all(ids.map((id) => count("lesson_reports", id))),
    Promise.all(ids.map((id) => count("attendance_records", id))),
  ]);
  const sent = Object.fromEntries(ids.map((id, i) => [id, sentArr[i]!]));
  const attended = Object.fromEntries(ids.map((id, i) => [id, attArr[i]!]));
  const main = pickMainClass(ids, sent, attended);
  return main ? { ok: true, classId: main } : { ok: false, reason: "choose", candidates };
}
