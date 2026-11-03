import "server-only";
import { getHomeroomConsultStats } from "@/features/consultations/server/homeroom";
import { getConsultationStats } from "@/features/consultations/server/stats";
import { CONSULTATION_CATEGORY_LABEL } from "@/features/consultations/labels";
import { homeroomTrendRows } from "@/features/consultations/stats-recent";
import { reportError } from "@/lib/observability/report-error";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import { consultSubjectMonths, pendingOf, type ConsultRow, type ProgramKeyOf } from "./consult";
import type { ConsultExtras } from "./extras-types";

const sum = (values: readonly number[] | undefined) => (values ?? []).reduce((a, b) => a + b, 0);

/** 달 × 과목 건수 — 통계 집계는 반의 프로그램을 몰라 EiE를 못 가른다. 12개월이라 수천 행 이내다(B2 `fetchAllPaged`). */
async function loadSubjectMonths(months: string[], keyOf: ProgramKeyOf) {
  const db = await createClient();
  const rows = await fetchAllPaged<ConsultRow>((from, to) =>
    db.from("student_consultations").select("consulted_at, subject, class_id").gte("consulted_at", `${months[0]}-01T00:00:00+09:00`).order("id").range(from, to));
  const classes = await fetchInChunks<{ id: string; subject: string | null; english_track: string | null }>([...new Set(rows.flatMap((r) => (r.class_id ? [r.class_id] : [])))], (chunk) =>
    db.from("classes").select("id, subject, english_track").in("id", chunk));
  return consultSubjectMonths(rows, months, new Map(classes.map((c) => [c.id, c])), keyOf);
}

const failed = (scope: string) => (error: unknown) => {
  reportError(error, { scope: `dashboard.instruments.${scope}` });
  return null;
};

/**
 * 학생 상담 카드·상세의 값 — 상담 통계 화면과 같은 두 조회다(강사 범위도 그 안에서 좁혀진다).
 * 담임 현황은 무거운 조회라 실패해도 주별 값은 살린다(통계 화면과 같은 처리).
 * `keyOf`가 없으면(강사 범위) 과목별 달 값을 만들지 않는다.
 */
export async function loadConsultExtras(keyOf: ProgramKeyOf | null): Promise<ConsultExtras | null> {
  const [stats, homeroom] = await Promise.all([getConsultationStats({}), getHomeroomConsultStats().catch(failed("consult-homeroom"))]);
  if (!stats.full) return null;
  const bySubject = keyOf ? await loadSubjectMonths(stats.buckets.month.map((m) => m.b.slice(0, 7)), keyOf).catch(failed("consult-subjects")) : null;
  const trend = homeroom ? homeroomTrendRows(homeroom) : null;
  const teachers = new Map(homeroom?.teachers.map((t) => [t.id, t]));
  return {
    weeks: stats.buckets.week,
    months: stats.buckets.month,
    bySubject,
    categories: (stats.dims.category?.items ?? [])
      .map((item) => ({ label: (item.k && CONSULTATION_CATEGORY_LABEL[item.k]) || "분류 없음", recent: sum(item.w) }))
      .filter((c) => c.recent > 0)
      .sort((a, b) => b.recent - a.recent),
    homeroom: trend && trend.rows.length ? { months: trend.months, rows: trend.rows.map((r) => ({ ...r, classNames: teachers.get(r.id)?.classNames ?? [], pending: pendingOf(teachers.get(r.id)?.students ?? []) })) } : null,
  };
}
