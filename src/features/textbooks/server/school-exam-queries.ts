import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { normalizeSchoolName } from "@/features/schools/school-name";
import type { ExamTerm, SchoolExamOverride } from "../exam-periods";

/**
 * 학교별 내신기간 조회 — **admin + `tenant_id` 명시 필터**. 게이트는 호출부가 먼저 통과시킨다.
 * 표가 없거나(마이그레이션 전) 실패하면 빈 맵 + 상태 — 계산은 기본표로 산다.
 */
export type SchoolExamRow = { schoolKey: string; schoolLabel: string; schoolYear: number; term: ExamTerm; from: string; to: string };
export type SchoolExamStatus = "ok" | "missing-table" | "failed";

/** 학생 학교 원문들 → 매칭 키별 덮어쓰기 목록. */
export async function getSchoolExamPeriods(
  tenantId: string,
  schools: readonly (string | null | undefined)[],
): Promise<{ status: SchoolExamStatus; rows: SchoolExamRow[]; byKey: Map<string, SchoolExamOverride[]> }> {
  const keys = [...new Set(schools.map((s) => normalizeSchoolName(s)).filter(Boolean))];
  const byKey = new Map<string, SchoolExamOverride[]>();
  if (keys.length === 0) return { status: "ok", rows: [], byKey };
  return readSchoolExams(tenantId, keys, byKey);
}

/** 이 학원의 학교별 내신기간 전부(학교 수 × 학년도 × 시험이라 작다) — 학생 목록을 기다리지 않아도 된다. */
export async function getAllSchoolExamPeriods(tenantId: string) {
  return readSchoolExams(tenantId, null, new Map<string, SchoolExamOverride[]>());
}

async function readSchoolExams(tenantId: string, keys: string[] | null, byKey: Map<string, SchoolExamOverride[]>): Promise<{ status: SchoolExamStatus; rows: SchoolExamRow[]; byKey: Map<string, SchoolExamOverride[]> }> {
  const admin = createAdminClient();
  try {
    type Raw = { school_key: string; school_label: string; school_year: number; term: ExamTerm; from_date: string; to_date: string };
    const cols = "id, school_key, school_label, school_year, term, from_date, to_date";
    const raw = keys
      ? await fetchInChunks<Raw>(keys, (chunk) => admin.from("school_exam_periods").select(cols).eq("tenant_id", tenantId).in("school_key", chunk))
      : await fetchAllPaged<Raw>((f, t) => admin.from("school_exam_periods").select(cols).eq("tenant_id", tenantId).order("id").range(f, t));
    const rows = raw.map((r) => ({ schoolKey: r.school_key, schoolLabel: r.school_label, schoolYear: r.school_year, term: r.term, from: r.from_date.slice(0, 10), to: r.to_date.slice(0, 10) }));
    for (const r of rows) byKey.set(r.schoolKey, [...(byKey.get(r.schoolKey) ?? []), { schoolYear: r.schoolYear, term: r.term, from: r.from, to: r.to }]);
    return { status: "ok", rows, byKey };
  } catch (e) {
    const msg = (e as { message?: string }).message ?? "";
    const missing = msg.includes("school_exam_periods") && /not find|does not exist|schema cache/i.test(msg);
    return { status: missing ? "missing-table" : "failed", rows: [], byKey };
  }
}
