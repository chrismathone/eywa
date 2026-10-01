import "server-only";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";
import {
  consultationSubjectValues,
  filteredConsultations,
  getStudentsNeedingConsultation,
  rangeSinceIso,
  type ConsultationListFilters,
} from "./queries";
import { classSchemaWorthTrying, isMissingClassSchema, noteClassSchema } from "./class-support";
import { getNotStartedStudentIds } from "@/features/students/server/enrolled-programs";
import type { ConsultationStats, GapStats, StatsDimKey } from "../stats-model";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 아무에게도 안 맞는 상담사 id — "이 조건이면 0건"을 RPC에 그대로 전한다. */
const NOBODY = "00000000-0000-0000-0000-000000000000";

/**
 * 원생상담 **통계**의 집계(원장 2026-09-30 *"우측에 상담 통계 고도화. 모든 것을 관리 통계 추이 가능하게."* → 2026-10-01 목록 위 요약 띠 +
 * `/consultations/stats` 전용 화면 — 둘 다 이 함수 하나를 같은 필터로 부른다).
 *
 * 🔴 목록과 **같은 조건**을 탄다 — 강사 스코프(본인 상담만) · 기간 · 카테고리 · 후속 · 상담사 · 과목(키·라벨). 검색어는 목록 전용.
 *    같은 필터를 두 곳이 따로 풀면 통계 수치와 목록 건수가 갈린다(queries.ts `filteredConsultations` 한 벌 + RPC는 같은 식).
 * 🔴 집계는 DB에서(0318a `consultation_stats` group-by RPC, B2) — 행을 끌어와 JS로 세지 않는다.
 * [[#95]] RPC가 없으면(SQL 적용 전) **건수 카드만** 헤드 카운트로 채운다(추이·분해는 빈 채로 — 가능한 지표만).
 */
export async function getConsultationStats(filters: ConsultationListFilters): Promise<ConsultationStats> {
  const supabase = await createClient();
  const teacherId = await effectiveTeacherId();
  const today = kstToday();
  // 상담사 조건 — 목록(`filteredConsultations`)은 강사 스코프와 상담사 필터를 **둘 다** 건다. 강사가 남의 id를 주소에 넣으면
  // 목록은 0건이다 — 통계가 그때 자기 통계를 보여 주면 두 숫자가 갈린다. uuid가 아닌 값도 목록은 0건(조회 오류)이라 같은 0으로 맞춘다.
  const wanted = filters.counselor && filters.counselor !== "all" ? filters.counselor : null;
  const wantedId = wanted === null ? null : UUID_RE.test(wanted) ? wanted : NOBODY;
  const counselor = teacherId ? (wantedId && wantedId !== teacherId ? NOBODY : teacherId) : wantedId;

  if (classSchemaWorthTrying()) {
    const { data, error } = await supabase.rpc("consultation_stats", {
      p_since: rangeSinceIso(filters.range),
      p_category: filters.cat && filters.cat !== "all" ? filters.cat : null,
      p_urgency: filters.urg && filters.urg !== "all" ? filters.urg : null,
      p_counselor: counselor,
      p_subjects: consultationSubjectValues(filters),
      p_today: today,
      p_top: 12,
    });
    if (!error && data) {
      noteClassSchema(true);
      return { full: true, today, ...(data as Omit<Extract<ConsultationStats, { full: true }>, "full" | "today">) };
    }
    if (error && !isMissingClassSchema(error)) throw new Error(`상담 통계 조회 실패: ${error.message}`);
    if (error) noteClassSchema(false);
  }

  // 폴백 — 헤드 카운트(행 0)만. 필터는 목록과 같은 함수로 건다.
  const head = () =>
    filteredConsultations(
      supabase.from("student_consultations").select("*", { count: "exact", head: true }),
      filters,
      teacherId,
    );
  const results = await Promise.all([
    head(),
    head().eq("follow_up_done", true),
    head().eq("follow_up_done", false).not("follow_up_date", "is", null),
    head().eq("follow_up_done", false).not("follow_up_date", "is", null).lt("follow_up_date", today),
    head().not("audio_path", "is", null),
    head().not("ai_summary", "is", null),
    head().not("makeedu_id", "is", null),
  ]);
  for (const r of results) if (r.error) throw new Error(`상담 통계 조회 실패: ${r.error.message}`);
  const [n, done, pending, overdue, audio, ai, synced] = results.map((r) => r.count ?? 0);
  return { full: false, today, totals: { n, done, pending, overdue, audio, ai, synced } };
}

/**
 * 상담 공백 재원생 — 30·60·90일+ · 이력 없음(오늘 기준). **필터와 무관**하다: '마지막 상담'은 누가·무슨 분류로 했든 마지막이다
 * (다른 상담사가 어제 상담한 학생을 재촉하면 거짓 할 일). 좁히는 건 학생 집합뿐 — 강사는 담당 학생, 사무실은 재원생 전체.
 */
export async function getConsultationGap(): Promise<GapStats> {
  const scope = await effectiveTeacherScope();
  const today = kstToday();
  if (scope && scope.studentIds.length === 0) return { full: true, today, enrolled: 0, never: 0, d30: 0, d60: 0, d90: 0, top: [] };
  if (classSchemaWorthTrying()) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("consultation_gap_students", {
      p_student_ids: scope ? scope.studentIds : null,
      p_today: today,
      p_limit: 10,
    });
    if (!error && data) return { full: true, today, ...(data as Omit<Extract<GapStats, { full: true }>, "full" | "today">) };
    if (error && !isMissingClassSchema(error)) throw new Error(`상담 공백 조회 실패: ${error.message}`);
  }
  // 폴백(0318a 전) — 옛 통계 화면의 함수(fetchAllPaged)로 30일+만 센다. RPC와 같은 집합을 보게 '아직 시작 안 한 재원생'은 뺀다
  // (운영실·원생목록의 '실시간 재원생'과 같은 판정 — notYetStartedStudentIds).
  const [{ rows: allRows }, notStarted] = await Promise.all([getStudentsNeedingConsultation(30, 10_000), getNotStartedStudentIds()]);
  const rows = allRows.filter((r) => !notStarted.has(r.id));
  const never = rows.filter((r) => r.lastConsultedAt === null).length;
  return {
    full: false,
    today,
    d30plus: rows.length,
    never,
    top: rows.slice(0, 10).map((r) => ({ id: r.id, name: r.name, grade: r.grade, last: r.lastConsultedAt, days: r.daysSince })),
  };
}

export type { ConsultationStats, GapStats, StatsDimKey };
