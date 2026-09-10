import "server-only";

/**
 * 성적관리 'JJ실'·'JJ실(시험)'과 학생 상세 '성적' 탭의 인재원 데이터 조회(사용자 2026-09-10).
 *
 * 🔑 eywa에 저장하는 것은 **짝 하나**(students.ijw_student_id, 0259a)뿐이다 — 숫자는 매번 인재원에 묻는다.
 * 🔑 강사(세 갈래 스코프, viewer.ts)는 **짝이 걸린 자기 학생 행만** 본다 — 짝이 없는 행은 누구 학생인지 알 수 없어서다.
 *    짝 칸이 아직 없으면(0259a 적용 전) 강사는 담당 학생을 가려낼 수 없다 → 빈 화면이 아니라 '준비 전'(scopeNotReady).
 * 🔴 조회 실패는 던지지 않는다(links.ts와 같은 규약) — 곁가지 구역이 화면 전체를 오류로 바꾸지 않게.
 * ⚠️ admin 클라이언트는 RLS를 우회한다 → students 조회마다 tenant_id를 건다(tenant-guard.test.ts가 잠근다).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import {
  IJW_SCHEMAS,
  type IjwDeckResult,
  type IjwExamListItem,
  type IjwExamSummary,
  type IjwStudy,
  type IjwStudySummaryRow,
} from "../contract";
import { isMissingIjwColumn } from "../db-errors";
import { IJW_PATHS, ijwGet, type IjwFailure } from "./client";
import { loadLinkIndex, localFailure, type EywaLink } from "./links";
import type { JjViewer } from "./viewer";

// 소비처가 한 곳에서 가져가도록(성적관리·결과 창·학생 상세).
export { getJjAccess, getJjViewer, type JjAccess, type JjViewer } from "./viewer";
export { getIjwLinkSuggestions, type EywaLink, type PoolStudent } from "./links";

export type JjStudyRow = IjwStudySummaryRow & { eywa: EywaLink | null };
export type JjStudyList = {
  ok: true;
  from: string;
  to: string;
  rows: JjStudyRow[];
  columnMissing: boolean;
  /** 강사인데 짝 칸이 없어 담당 학생을 가려낼 수 없다. */
  scopeNotReady: boolean;
};

/** JJ실 — 학생별 기간 학습 요약(설명서 8번). 강사면 자기 학생만. */
export async function getJjStudyList(viewer: JjViewer, from: string, to: string): Promise<JjStudyList | IjwFailure> {
  const [res, links] = await Promise.all([
    ijwGet(viewer.tenantId, IJW_PATHS.studySummary(from, to), IJW_SCHEMAS.studySummary),
    loadLinkIndex(viewer.tenantId),
  ]);
  if (!res.ok) return res;
  if (links.failure) return links.failure;
  let rows: JjStudyRow[] = res.data.students.map((s) => ({ ...s, eywa: links.byIjw.get(s.ijwId) ?? null }));
  const mine = viewer.teacherStudentIds;
  if (mine) rows = rows.filter((r) => r.eywa && mine.has(r.eywa.studentId));
  return {
    ok: true,
    from: res.data.from || from,
    to: res.data.to || to,
    rows,
    columnMissing: links.columnMissing,
    scopeNotReady: !!mine && links.columnMissing,
  };
}

/**
 * JJ실(시험) — 시험별 응시·평균·최고·최저(설명서 6번). 학원 전체 집계다.
 * 🔴 담당(세 갈래) 반에 영어가 없는 강사에겐 비운다 — 칩을 감춰도 주소를 직접 치면 열리므로 여기서도 막는다(#77).
 */
export async function getJjExamSummary(
  viewer: JjViewer,
  from?: string,
  to?: string,
): Promise<{ ok: true; exams: IjwExamSummary[] } | IjwFailure> {
  if (viewer.teacherStudentIds && !viewer.hasEnglish) return { ok: true, exams: [] };
  const res = await ijwGet(viewer.tenantId, IJW_PATHS.examSummary(from, to), IJW_SCHEMAS.examSummary);
  return res.ok ? { ok: true, exams: res.data.exams } : res;
}

export type JjDeckRow = IjwDeckResult & { eywa: EywaLink | null };
export type JjDeckResults = {
  ok: true;
  deck: { id: string; name: string; examType: string };
  rows: JjDeckRow[];
  columnMissing: boolean;
  scopeNotReady: boolean;
};

/** 시험 하나의 학생별 결과(설명서 7번). 강사면 자기 학생만. */
export async function getJjDeckResults(viewer: JjViewer, deckId: string): Promise<JjDeckResults | IjwFailure> {
  const [res, links] = await Promise.all([
    ijwGet(viewer.tenantId, IJW_PATHS.deckResults(deckId), IJW_SCHEMAS.deckResults),
    loadLinkIndex(viewer.tenantId),
  ]);
  if (!res.ok) return res;
  if (links.failure) return links.failure;
  let rows: JjDeckRow[] = res.data.results.map((r) => ({ ...r, eywa: links.byIjw.get(r.ijwId) ?? null }));
  const mine = viewer.teacherStudentIds;
  if (mine) rows = rows.filter((r) => r.eywa && mine.has(r.eywa.studentId));
  return {
    ok: true,
    deck: res.data.deck,
    rows,
    columnMissing: links.columnMissing,
    scopeNotReady: !!mine && links.columnMissing,
  };
}

export type StudentJj =
  | { state: "unlinked" }
  | { state: "error"; failed: IjwFailure }
  | { state: "linked"; ijwId: string; exams: IjwExamListItem[]; study: IjwStudy | null; failed: IjwFailure | null };

/** 학생 상세 '성적' 탭 — 짝이 있으면 최근 시험 목록 + 기간 학습 분석(설명서 2·4번). 던지지 않는다. */
export async function getStudentJj(tenantId: string, studentId: string, from: string, to: string): Promise<StudentJj> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("students")
    .select("ijw_student_id")
    .eq("tenant_id", tenantId)
    .eq("id", studentId)
    .maybeSingle();
  if (error) {
    if (isMissingIjwColumn(error)) return { state: "unlinked" };
    return { state: "error", failed: localFailure(error, "student-jj") };
  }
  const ijwId = (data as { ijw_student_id: string | null } | null)?.ijw_student_id ?? null;
  if (!ijwId) return { state: "unlinked" };
  const [exams, study] = await Promise.all([
    ijwGet(tenantId, IJW_PATHS.studentExams(ijwId), IJW_SCHEMAS.studentExams),
    ijwGet(tenantId, IJW_PATHS.study(ijwId, from, to), IJW_SCHEMAS.study),
  ]);
  return {
    state: "linked",
    ijwId,
    exams: exams.ok ? exams.data.exams : [],
    study: study.ok ? study.data : null,
    failed: !exams.ok ? exams : !study.ok ? study : null,
  };
}
