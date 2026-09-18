import { schoolGradeLabel } from "@/lib/format/school-grade";

/**
 * 단체 배정의 순수 규칙(원장 2026-09-18) — 반 상세 '학생 배정' 창의 **단체 배정 모드**가 쓴다.
 * 서버 액션(`createEnrollmentsBulk`)과 화면이 같은 상한·같은 결과 모양을 본다.
 */

/** 한 번에 배정할 수 있는 최대 인원 — 특강 한 반이 넘을 일이 없는 수(넘으면 나눠서). */
export const BULK_ASSIGN_MAX = 100;

export type BulkAssignResult = {
  studentId: string;
  ok: boolean;
  error?: string;
  enrollmentId?: string;
};

export type BulkCandidate = {
  id: string;
  name: string;
  grade: string | null;
  school?: string | null;
};

/** 목록에 보이는 학교·학년 — 앱 전역 표기("경명여중1")와 같게. */
export function candidateMeta(c: BulkCandidate): string {
  return schoolGradeLabel(c.school ?? null, c.grade);
}

/**
 * 검색 — 이름·학교·학년·표기("경명여중1")를 한 칸에서 찾는다. 띄어 쓴 낱말은 **모두** 맞아야 한다
 * ("고1 경명"처럼 좁혀 가려고). 특강은 대개 학년·학교 단위라 이름만 찾게 두면 한 명씩 치게 된다.
 */
export function filterBulkCandidates<T extends BulkCandidate>(options: T[], query: string): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return options;
  return options.filter((c) => {
    const hay = [c.name, c.school ?? "", c.grade ?? "", candidateMeta(c)].join(" ").toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}

/**
 * '보이는 학생 모두 선택' — 보이는 학생이 **전부** 이미 골라져 있으면 그들만 빼고, 아니면 모두 더한다.
 * 🔴 안 보이는(검색으로 가려진) 선택은 건드리지 않는다 — 검색어를 바꿔 가며 여러 무리를 모으는 흐름이라서.
 */
export function toggleVisible(selected: string[], visibleIds: string[]): string[] {
  if (visibleIds.length === 0) return selected;
  const have = new Set(selected);
  if (visibleIds.every((id) => have.has(id))) {
    const visible = new Set(visibleIds);
    return selected.filter((id) => !visible.has(id));
  }
  return [...selected, ...visibleIds.filter((id) => !have.has(id))];
}
