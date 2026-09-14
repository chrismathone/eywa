/**
 * ECS 교시 카드 로스터의 **표시 순서·섹션 분리** — 순수 모듈(Vitest).
 *
 * 시간표 셀([student-sort.ts](src/features/timetable/lib/student-sort.ts))과 같은 문법:
 * 재원 → 퇴원, 재원은 가나다, 퇴원은 최신 종료일 먼저. ECS엔 신입/전입 하위 순위가 없어(그 개념은
 * 시간표 셀 전용) comparator를 공유하지 않고 같은 규칙만 따른다.
 *
 * 섹션 5개:
 *  · active    = 그 날짜 수강 대상(입력 가능). 라벨 없음(기본 명단).
 *  · makeup    = 보강(수업외) — 수강행 없이 그날 출결이 있는 학생. 입력 가능.
 *  · classEnded= 유예(30일) 안에 **이 반만** 끝나고 같은 과목 다른 반을 계속 다니는 학생 — 퇴원이 아니라 종강.
 *                grid의 `endedOn` + `endedContinuesIn`이 있는 행. 읽기 전용.
 *                (원장 2026-09-14 *"1과목이 완전히 종료되면 그 과목에 대해서는 퇴원"* — 한 반만 끝난 건 퇴원이 아니다.
 *                 판정은 월별 출석부 뱃지와 같은 `continuesIn`.)
 *  · withdrawn = 유예(30일) 안에 수강이 끝난 학생 — grid의 `endedOn`이 있는 행. 읽기 전용.
 *  · record    = 그 외 비eligible인데 기록(마크만 등)이 있어 남은 행. 읽기 전용.
 *    ⚠️ record를 '퇴원'으로 뭉뚱그리지 말 것 — 유예가 지난 퇴원생, 대기(휴원) 중 기록,
 *    이 반 수강 기록 자체가 없는 학생(임포트 잔재)이 섞여 있어 퇴원이라 부르면 거짓 표시가 된다.
 *
 * ⚠️ 순수 모듈 — server-only·클라 컴포넌트 어느 쪽도 import하지 않는다(구조적 타입만). [[#61]]
 */
export type OrderableRosterRow = {
  studentId: string;
  eligible: boolean;
  /** 보강(수업외) — 수강행 없이 그날 출결. 있으면 '보강' 섹션. */
  isMakeup?: boolean;
  /** 수강 종료일(YYYY-MM-DD) — 있으면 '퇴원' 섹션(아래 값도 있으면 '종강'). */
  endedOn?: string | null;
  /** 계속 다니는 같은 과목 다른 반 이름 — `endedOn`과 함께 있으면 '종강' 섹션(퇴원 아님). */
  endedContinuesIn?: string | null;
};

export type RosterGroupKey = "active" | "makeup" | "classEnded" | "withdrawn" | "record";

export type RosterGroup<T> = {
  key: RosterGroupKey;
  /** 섹션 라벨(null=기본 명단, 라벨 행 없음). */
  label: string | null;
  rows: T[];
};

const GROUP_LABEL: Record<RosterGroupKey, string | null> = {
  active: null,
  makeup: "보강",
  classEnded: "종강",
  withdrawn: "퇴원",
  record: "기록",
};

/** 섹션 표시 순서 — 아직 학원에 다니는 종강 학생이 그만둔 퇴원 학생보다 위. */
const GROUP_ORDER: readonly RosterGroupKey[] = ["active", "makeup", "classEnded", "withdrawn", "record"];

function groupOf(row: OrderableRosterRow): RosterGroupKey {
  if (row.eligible) return "active";
  if (row.isMakeup) return "makeup";
  if (row.endedOn) return row.endedContinuesIn ? "classEnded" : "withdrawn";
  return "record";
}

/**
 * 섹션별로 나눠 정렬한다. **빈 섹션은 반환하지 않는다**(라벨만 뜨는 빈 구역 방지).
 * `nameOf`는 학생 표시 이름(없으면 빈 문자열) — 이름을 모르면 id 순으로 안정 정렬된다.
 */
export function groupRosterRows<T extends OrderableRosterRow>(
  roster: readonly T[],
  nameOf: (studentId: string) => string,
): RosterGroup<T>[] {
  const buckets: Record<RosterGroupKey, T[]> = {
    active: [],
    makeup: [],
    classEnded: [],
    withdrawn: [],
    record: [],
  };
  for (const row of roster) buckets[groupOf(row)].push(row);

  const byName = (a: T, b: T) => {
    const cmp = nameOf(a.studentId).localeCompare(nameOf(b.studentId), "ko");
    return cmp !== 0 ? cmp : a.studentId.localeCompare(b.studentId);
  };
  const byLatestEnd = (a: T, b: T) => {
    const cmp = (b.endedOn ?? "").localeCompare(a.endedOn ?? "");
    return cmp !== 0 ? cmp : byName(a, b);
  };
  buckets.active.sort(byName);
  buckets.makeup.sort(byName);
  buckets.record.sort(byName);
  // 종강·퇴원은 최신순(끝난 지 얼마 안 된 학생이 위) — 시간표 셀과 같은 규칙.
  buckets.classEnded.sort(byLatestEnd);
  buckets.withdrawn.sort(byLatestEnd);

  return GROUP_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
    key,
    label: GROUP_LABEL[key],
    rows: buckets[key],
  }));
}
