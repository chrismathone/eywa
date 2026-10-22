import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { testScoresOf } from "@/features/math-sheets/lib/test-score";
import { gradeKind, numberOrNull } from "@/features/grades/unified/server/normalize";
import { kstDateOf } from "../model/dates";
import { GRADE_KINDS, type EvaluationSources, type GradeKind, type SnapshotClaim, type SnapshotGrade, type SnapshotJudgment, type SnapshotLeave, type SnapshotStaffDay } from "../model/source-types";
import { paged } from "./churn-source";

/**
 * 강사평가 지표 셋의 재료 — 성적(성적 입력 + 보고서 시험) · 학부모 글 판정·클레임(0364a) · 직원 출퇴근(0365a)·결재된 휴가.
 * 스냅샷(`snapshot.ts`)이 한 번에 부른다. 🔴 admin 클라이언트 → 모든 조회에 tenant_id · 전건 페이징(B2).
 * ⚠️ 보고서는 **시험 점수 칸만** 읽는다(본문 아님) · 학부모 글 본문은 읽지 않는다(판정 줄의 근거 문구만).
 * ⚠️ 새 표가 아직 없는 DB(SQL 적용 전)는 그 칸만 null — 집계 전체를 멈추지 않는다(#95). 다른 오류(일시 오류 포함)는 다른 조회처럼 멈춘다
 *    (마감 날 0점으로 굳지 않게 — 표가 없다는 오류 모양만 삼킨다).
 * 🔑 조회(`fetchEvaluationSourceRows`)는 스냅샷 첫 묶음과 나란히 돌고, 테스트 학생·반 과목이 필요한 정리(`toEvaluationSources`)는 그 뒤에.
 */
type Admin = SupabaseClient;
// PGRST205 "Could not find the table 'public.x' in the schema cache" · 42P01 'relation "public.x" does not exist' — 그 표 이름이 든 것만.
const missing = (e: unknown, table: string) => e instanceof Error
  && new RegExp(`Could not find the table '[^']*${table}'|relation "[^"]*${table}" does not exist`).test(e.message);
const isKind = (k: string): k is GradeKind => (GRADE_KINDS as readonly string[]).includes(k);
export type RawGrade = { id: string; student_id: string; exam_name: string; exam_slot: string | null; subject: string; class_id: string | null; score: string | null; max_score: string | null; taken_on: string; no_exam: boolean | null; created_at: string };
export type RawReport = { id: string; student_id: string; class_id: string | null; subject: string | null; report_date: string; created_at: string | null; daily_test: string | null; check_test: string | null; exam_info: string | null };

export type SourceRows = Awaited<ReturnType<typeof fetchEvaluationSourceRows>>;

export async function fetchEvaluationSourceRows(admin: Admin, tenantId: string, { from, end }: { from: string; end: string }) {
  const inTenant = (table: string, columns: string) => admin.from(table).select(columns).eq("tenant_id", tenantId);
  const [grades, reports, judgments, claims, days, leaves, latest] = await Promise.all([
    paged<RawGrade>((a, b) => inTenant("student_grades", "id, student_id, exam_name, exam_slot, subject, class_id, score, max_score, taken_on, no_exam, created_at")
      .gte("taken_on", from).lte("taken_on", end).order("id").range(a, b)),
    // 성적 원장과 같은 줄 — 학부모 링크를 회수한 보고서(`revoked_at`)도 시험은 그대로 보인다.
    paged<RawReport>((a, b) => inTenant("lesson_reports", "id, student_id, class_id, subject, report_date, created_at, daily_test, check_test, exam_info")
      .gte("report_date", from).lte("report_date", end)
      .or("daily_test.not.is.null,check_test.not.is.null,exam_info.not.is.null").order("id").range(a, b)),
    paged<SnapshotJudgment>((a, b) => inTenant("teacher_satisfaction_judgments", "id, student_id, posted_on, class_id, subjects, verdict, phrase, method, state")
      .in("state", ["applied", "pending"]).gte("posted_on", from).lte("posted_on", end).order("id").range(a, b))
      .catch((e: unknown) => { if (missing(e, "teacher_satisfaction_judgments")) return null; throw e; }),
    paged<SnapshotClaim & { points: number | string }>((a, b) => inTenant("teacher_satisfaction_claims", "id, teacher_id, student_id, occurred_on, points, content")
      .is("cancelled_at", null).gte("occurred_on", from).lte("occurred_on", end).order("id").range(a, b))
      .catch((e: unknown) => { if (missing(e, "teacher_satisfaction_claims")) return null; throw e; }),
    paged<SnapshotStaffDay>((a, b) => inTenant("staff_attendance_days", "user_id, work_date, status, late_minutes, check_in_at, check_out_at")
      .gte("work_date", from).lte("work_date", end).order("id").range(a, b))
      .catch((e: unknown) => { if (missing(e, "staff_attendance_days")) return null; throw e; }),
    // 결재된 휴가(연차·반차·반반차) — 전자결재 휴가 양식이 승인된 것만(달력 휴가 겹침과 같은 조회).
    paged<{ user_id: string; start_date: string; end_date: string }>((a, b) => admin.from("leave_forms")
      .select("user_id, start_date, end_date, doc:approval_documents!leave_forms_document_id_fkey!inner(status)")
      .eq("tenant_id", tenantId).eq("doc.status", "approved").lte("start_date", end).gte("end_date", from).order("document_id").range(a, b)),
    // 메이크에듀 출퇴근을 어디까지 받았나 — 가장 늦은 날짜(창 밖 오늘 줄까지). 연동은 매번 지난달 1일 ~ 오늘을 통째로 받으므로
    // 이 날짜 전날까지는 다 받은 것이다(그날 저녁 태그는 다음 동기화에 온다 — 근태가 '아직 안 받은 날'을 결근으로 세지 않게).
    Promise.resolve(admin.from("staff_attendance_days").select("work_date").eq("tenant_id", tenantId).eq("source", "makeedu")
      .order("work_date", { ascending: false }).limit(1)).then(({ data, error }) => {
      if (error) { if (missing(new Error(error.message), "staff_attendance_days")) return null; throw new Error(`출퇴근 조회 실패: ${error.message}`); }
      return (data?.[0]?.work_date as string | undefined) ?? null;
    }),
  ]);
  return { grades, reports, judgments, claims, days, leaves, latest };
}

export function normalizeEvaluationGrades({ grades, reports }: Pick<SourceRows, "grades" | "reports">, input: {
  isTest: (studentId: string) => boolean; subjectOfClass: (classId: string) => string | null;
}): SnapshotGrade[] {
  const out: SnapshotGrade[] = [];
  for (const g of grades) {
    const score = numberOrNull(g.score), max = numberOrNull(g.max_score);
    const kind = gradeKind(g.exam_slot, g.exam_name);
    if (g.no_exam || input.isTest(g.student_id) || score === null || max === null || max <= 0 || !isKind(kind)) continue;
    out.push({ id: `grade:${g.id}`, student_id: g.student_id, subject: g.subject, class_id: g.class_id, day: g.taken_on, entered: kstDateOf(g.created_at), kind, score, max });
  }
  for (const r of reports) {
    // 과목이 빈 옛 보고서는 그 반의 과목(성적 원장과 같은 순서) — 반도 없으면 뺀다.
    const subject = r.subject || (r.class_id ? input.subjectOfClass(r.class_id) : null);
    if (!subject || input.isTest(r.student_id)) continue;
    for (const t of testScoresOf({ dailyTest: r.daily_test, checkTest: r.check_test, examInfo: r.exam_info })) {
      if (t.correct === null || t.total === null || t.total <= 0) continue;
      out.push({
        id: `report:${r.id}:${t.kind}`, student_id: r.student_id, subject, class_id: r.class_id, day: r.report_date, entered: kstDateOf(r.created_at),
        kind: t.kind === "legacy" ? "other" : t.kind, score: t.correct, max: t.total,
      });
    }
  }
  return out;
}

export function toEvaluationSources(rows: SourceRows, input: {
  isTest: (studentId: string) => boolean; subjectOfClass: (classId: string) => string | null;
}): EvaluationSources {
  const { judgments, claims, days, leaves, latest } = rows;
  const out = normalizeEvaluationGrades(rows, input);
  const real = <T extends { student_id: string | null }>(rows: T[]) => rows.filter((r) => !(r.student_id && input.isTest(r.student_id)));
  return {
    grades: out,
    satisfaction: judgments && claims ? { judgments: real(judgments), claims: real(claims).map((c) => ({ ...c, points: Number(c.points) })) } : null,
    punctuality: { days, latest, leaves: leaves.map((l): SnapshotLeave => ({ user_id: l.user_id, start_date: l.start_date, end_date: l.end_date })) },
  };
}
