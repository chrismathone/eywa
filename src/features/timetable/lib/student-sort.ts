/**
 * 시간표 셀 학생 표시 순서 — 서버(queries.ts)·클라(합반 통합 명단) **단일 소스** comparator.
 * 재원 → 대기 → 퇴원. 재원 안에서는 신입(30일 이내) > 준신입(31~60일) > 반이동(전입) > 기존(그룹 내 가나다),
 * 퇴원은 최신순(endDate desc),
 * 대기·기존은 가나다. status 미지정(구버전 호출)은 재원으로 간주(class-cell의 `?? "active"` 규약과 동일).
 *
 * ⚠️ 순수 모듈 — server-only·클라 컴포넌트 어느 쪽도 import하지 않는다(구조적 타입만). [[#61]]
 */
export type SortableStudentLine = {
  name: string;
  status?: "active" | "hold" | "withdrawn";
  isNew?: boolean;
  /**
   * 등록 31~60일(신입 다음 단계) — 서버가 신입·전입과 **상호배타**로 채운다(queries.ts `isRecent`).
   * 🔴 이 필드가 타입에 없으면 준신입이 "기존"으로 떨어져 **색은 분홍인데 자리는 가나다 속**이 된다.
   */
  isRecent?: boolean;
  isTransferredIn?: boolean;
  endDate?: string | null;
};

const rank = (l: SortableStudentLine) => {
  const st = l.status ?? "active";
  return st === "active" ? 0 : st === "hold" ? 1 : 2;
};
// 신입(0) → 준신입(1) → 전입/반이동(2) → 기존(3) — 원장 2026-09-14 *"30일 이하 → 60일 이하 → 반이동"*.
// ⚠️ **검사 순서와 순위는 다른 축이다**: 검사는 전입이 먼저, 순위는 신입·준신입 뒤. 반이동 학생이 isNew에도
//    걸리는 경우(상호배타 보정 전 데이터·타 경로)에 "전입(반이동)"으로 분류돼야 색과 어긋나지 않는데
//    (studentRowTone·timetableStudentTone도 전입을 먼저 본다), 자리는 원장이 정한 대로 신입 뒤다.
const activeSubRank = (l: SortableStudentLine) =>
  l.isTransferredIn ? 2 : l.isNew ? 0 : l.isRecent ? 1 : 3;

/** 정렬 comparator — `list.sort(compareStudentLines)`. */
export function compareStudentLines(a: SortableStudentLine, b: SortableStudentLine): number {
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if ((a.status ?? "active") === "active" && activeSubRank(a) !== activeSubRank(b)) {
    return activeSubRank(a) - activeSubRank(b);
  }
  if (a.status === "withdrawn") return (b.endDate ?? "").localeCompare(a.endDate ?? "");
  return a.name.localeCompare(b.name, "ko");
}
