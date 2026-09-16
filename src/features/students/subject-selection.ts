/**
 * 상태 변경(퇴원·휴원) 다이얼로그의 선택 단위 = **과목**(순수 · Vitest).
 *
 * 원장 2026-09-16(다이얼로그 캡처): *"나는 분명히 과목 선택 가능하게 해달라한것 같은데, 수업 선택이
 * 아니라. 어차피 한과목만 그만둔다고 휴원이나 퇴원이 아님."* → *"내 말은 한 과목의 '한 수업'"*.
 * 수강 한 줄(반)씩 체크박스를 세웠더니 수학만 세 반 다니는 학생(송준영: 주말내신특강·BS4F 수·BS4F 토)이
 * **수학 한 과목인데 세 줄**로 보였다. 그만두거나 쉬는 단위는 반이 아니라 과목이다.
 *
 * 🔑 **서버 계약은 그대로**다 — 서버 액션은 여전히 `enrollmentIds`를 받는다. 과목 하나를 고르면 화면이
 *    그 과목의 **모든** 활성 수강 id로 펼쳐 보낸다(`idsOf`). 그래서 게이트·교집합 검사·감사로그가 한 줄도
 *    안 바뀐다(#77 — 새 쓰기 경로를 만들지 않는다).
 * 🔴 과목 키는 **학원설정 단일 소스**다 — 라벨·색·순서는 호출부가 `useSubjectMaps()`로 붙인다
 *    (여기서 과목 이름을 적지 않는다, 운영 enum 하드코딩 금지).
 */

export type SelectableEnrollment = {
  id: string;
  /** 과목 **키**(math·english…). */
  subject: string;
  className: string;
  onHold?: boolean;
};

export type SubjectGroup = {
  subject: string;
  /** 이 과목의 활성 수강 id 전부 — 고르면 이것이 통째로 제출된다. */
  enrollmentIds: string[];
  /** 반 이름(표시용 — 한 과목에 몇 반인지 보여 준다). */
  classNames: string[];
  /** 이 과목 수강 중 지금 대기인 수. */
  heldCount: number;
};

/**
 * 활성 수강 → 과목 묶음. 순서는 `order`(학원설정 과목 순서)를 따르고, 거기 없는 키는 처음 본 순서로 뒤에 선다.
 */
export function groupEnrollmentsBySubject(
  rows: readonly SelectableEnrollment[],
  order: readonly string[] = [],
): SubjectGroup[] {
  const map = new Map<string, SubjectGroup>();
  for (const r of rows) {
    const g = map.get(r.subject) ?? { subject: r.subject, enrollmentIds: [], classNames: [], heldCount: 0 };
    g.enrollmentIds.push(r.id);
    g.classNames.push(r.className);
    if (r.onHold) g.heldCount += 1;
    map.set(r.subject, g);
  }
  const rank = (key: string) => {
    const i = order.indexOf(key);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  // Map은 삽입 순서를 지킨다 → 설정에 없는 키끼리는 처음 본 순서(안정 정렬).
  return [...map.values()].sort((a, b) => rank(a.subject) - rank(b.subject));
}

/** 고른 과목들의 활성 수강 id 전부 — 서버 액션에 그대로 싣는 값. */
export function idsOf(groups: readonly SubjectGroup[], selected: ReadonlySet<string>): string[] {
  return groups.filter((g) => selected.has(g.subject)).flatMap((g) => g.enrollmentIds);
}

/**
 * 휴원 탭을 열 때의 선택 — **대기인 수강이 하나라도 있는 과목**, 대기가 아예 없으면 전 과목(= 종전 전체 휴원).
 *
 * 🔑 선택 = "쉬는 과목 전체"라, 이미 걸어 둔 휴원을 열었을 때 화면이 사실을 보여 주고 체크를 푸는 것만으로
 *    되돌릴 수 있다. ⚠️ 한 과목 안에서 일부 반만 대기인 경우(시간표 드래그로 한 반만 대기)엔 **체크된 채** 연다 —
 *    열자마자 "해제"를 제안하면 누르기만 해도 쉬던 반이 조용히 되살아난다. 대신 행에 '일부 대기'를 밝힌다.
 */
export function initialHoldSubjects(groups: readonly SubjectGroup[]): Set<string> {
  const held = groups.filter((g) => g.heldCount > 0).map((g) => g.subject);
  return new Set(held.length > 0 ? held : groups.map((g) => g.subject));
}
