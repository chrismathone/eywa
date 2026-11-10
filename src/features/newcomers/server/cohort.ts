import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import type { CheckRowInput, EnrollmentForAnchor } from "../subject-rows";

/**
 * 신규생 **과목별 행**의 재료 조회 — 신규생 탭(`getNewcomers`)과 운영실 신호(`newcomerOverdueSignal`)가
 * **같은 함수**를 쓴다(0256a).
 *
 * 🔴 두 곳이 따로 조회하면 한쪽만 과목을 알게 된다 — 그러면 탭은 과목별로 "사전 콜 대기"인데 운영실은
 *    학생 단위로 "완료"라고 말한다(같은 학생을 두 화면이 다르게 말하는 것이 이 앱에서 가장 흔한 사고다).
 * ⚠️ 이 파일은 `"use server"`가 아니다([[#119]]) — 서버 모듈이 import하는 조회 헬퍼다.
 */

type Supabase = Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createAdminClient>;

/**
 * 조회에 테넌트 필터를 거는 함수 — 세션 경로는 그대로(RLS가 격리), admin 경로(운영실 cron)는
 * `.eq("tenant_id", …)`를 건다. 🔴 admin은 RLS를 우회하므로 이 필터가 **유일한 격리선**이다.
 */
export type ScopeFn = <T>(query: T) => T;
const identity: ScopeFn = (q) => q;

/**
 * 학생들의 수강 → (학생, 시작일, **과목**). 과목은 학생이 아니라 **반**에 있다.
 * 🔑 반 표(과목)는 수강과 **독립**이라 병렬로 받는다(B4) — 수강을 기다렸다가 반 id로 다시 부르면 직렬이다.
 *    반은 학원 전체라 수백 행 — `fetchAllPaged`(1000행 절단 방지, B2).
 * ⚠️ 반 조회가 권한으로 0행이면 과목을 모르는 것뿐이다 — 학생마다 과목 없는 한 줄로 떨어진다(화면은 산다).
 */
export async function loadEnrollmentSubjects(
  supabase: Supabase,
  studentIds: readonly string[],
  scope: ScopeFn = identity,
): Promise<EnrollmentForAnchor[]> {
  if (studentIds.length === 0) return [];
  const [enrollments, classes] = await Promise.all([
    fetchInChunks<{
      student_id: string;
      start_date: string | null;
      end_date: string | null;
      class_id: string | null;
    }>([...studentIds], (chunk) =>
      scope(
        supabase.from("enrollments").select("student_id, start_date, end_date, class_id").in("student_id", chunk),
      ),
    ),
    fetchAllPaged<{ id: string; subject: string | null }>((from, to) =>
      scope(supabase.from("classes").select("id, subject").order("id", { ascending: true }).range(from, to)),
    ),
  ]);
  const subjectOf = new Map(classes.map((c) => [c.id, c.subject]));
  return enrollments.map((e) => ({
    studentId: e.student_id,
    startDate: e.start_date,
    endDate: e.end_date,
    subject: e.class_id ? (subjectOf.get(e.class_id) ?? null) : null,
  }));
}

/** 오류 원문 — plain object 오류는 `String(e)`가 `[object Object]`라 문구 판정에 안 걸린다([[#118]]). */
function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { code?: unknown; message?: unknown; details?: unknown };
    return `${String(o.code ?? "")} ${String(o.message ?? "")} ${String(o.details ?? "")}`;
  }
  return String(e);
}

/** `subject` 컬럼이 아직 없다(0256a 미적용) — 표가 없는 것(0251a 미적용)과는 다른 사실이다. */
export function isMissingSubjectColumn(e: unknown): boolean {
  const t = errText(e);
  return /subject/i.test(t) && /42703|PGRST204|does not exist|Could not find/i.test(t);
}

/**
 * 체크 기록 — **0256a 적용 전후 둘 다에서 돈다**([[#95]]).
 * `subject`를 먼저 읽어 보고, 그 컬럼이 없으면 옛 모양으로 다시 읽어 전부 과목 무관('')으로 돌려준다.
 * 🔴 다른 실패(표 부재 포함)는 삼키지 않고 `ok:false`로 올린다 — 호출부가 "미적용"과 "실패"를 가른다.
 */
export async function loadCheckRows(
  supabase: Supabase,
  studentIds: readonly string[],
  scope: ScopeFn = identity,
): Promise<{ ok: true; rows: CheckRowInput[]; subjectAware: boolean } | { ok: false; error: unknown }> {
  if (studentIds.length === 0) return { ok: true, rows: [], subjectAware: true };
  try {
    // 🔴 학생 100명 × 과목 × 항목이면 한 청크가 1,000행을 넘는다 — 청크 안에서도 페이징([[#54]]).
    const rows = await fetchAllPagedInChunks<{
      student_id: string;
      item_key: string;
      done_on: string | null;
      subject: string | null;
      memo: string|null;
      consultation_id: string|null;
    }>([...studentIds], (chunk, from, to) =>
      scope(
        supabase
          .from("student_onboarding_checks")
          .select("student_id, item_key, done_on, subject, memo, consultation_id")
          .in("student_id", chunk),
      ).order("id").range(from, to),
    );
    return {
      ok: true,
      subjectAware: true,
      rows: rows.map((r) => ({ studentId: r.student_id, itemKey: r.item_key, doneOn: r.done_on, subject: r.subject,memo:r.memo,consultationId:r.consultation_id })),
    };
  } catch (e) {
    if (!isMissingSubjectColumn(e)) return { ok: false, error: e };
  }
  try {
    const rows = await fetchAllPagedInChunks<{ student_id: string; item_key: string; done_on: string | null }>(
      [...studentIds],
      (chunk, from, to) =>
        scope(
          supabase.from("student_onboarding_checks").select("student_id, item_key, done_on").in("student_id", chunk),
        ).order("id").range(from, to),
    );
    return {
      ok: true,
      subjectAware: false,
      rows: rows.map((r) => ({ studentId: r.student_id, itemKey: r.item_key, doneOn: r.done_on, subject: "" })),
    };
  } catch (e) {
    return { ok: false, error: e };
  }
}
