/**
 * 시간표 셀 학생 표시 순서 — 서버(queries.ts)·클라(합반 통합 명단) **단일 소스** comparator.
 * 재원 → 대기 → 퇴원. 재원 안에서는 신입 > 반이동(전입) > 기존(그룹 내 가나다), 퇴원은 최신순(endDate desc),
 * 대기·기존은 가나다. status 미지정(구버전 호출)은 재원으로 간주(class-cell의 `?? "active"` 규약과 동일).
 *
 * ⚠️ 순수 모듈 — server-only·클라 컴포넌트 어느 쪽도 import하지 않는다(구조적 타입만). [[#61]]
 */
export type SortableStudentLine = {
  name: string;
  status?: "active" | "hold" | "withdrawn";
  isNew?: boolean;
  isTransferredIn?: boolean;
  endDate?: string | null;
};

const rank = (l: SortableStudentLine) => {
  const st = l.status ?? "active";
  return st === "active" ? 0 : st === "hold" ? 1 : 2;
};
// 신입(0) → 전입/반이동(1) → 기존(2). ⚠️ 전입을 먼저 검사 — 반이동 학생이 isNew에도 걸리는 경우
// (상호배타 보정 전 데이터·타 경로)에도 "전입(반이동)"으로 분류해 색(studentRowTone)·배지와 어긋나지 않게.
const activeSubRank = (l: SortableStudentLine) => (l.isTransferredIn ? 1 : l.isNew ? 0 : 2);

/** 정렬 comparator — `list.sort(compareStudentLines)`. */
export function compareStudentLines(a: SortableStudentLine, b: SortableStudentLine): number {
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if ((a.status ?? "active") === "active" && activeSubRank(a) !== activeSubRank(b)) {
    return activeSubRank(a) - activeSubRank(b);
  }
  if (a.status === "withdrawn") return (b.endDate ?? "").localeCompare(a.endDate ?? "");
  return a.name.localeCompare(b.name, "ko");
}
