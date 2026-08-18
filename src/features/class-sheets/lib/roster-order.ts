/**
 * ECS 교시 카드 로스터의 **표시 순서·섹션 분리** — 순수 모듈(Vitest).
 *
 * 시간표 셀([student-sort.ts](src/features/timetable/lib/student-sort.ts))과 같은 문법:
 * 재원 → 퇴원, 재원은 가나다, 퇴원은 최신 종료일 먼저. ECS엔 신입/전입 하위 순위가 없어(그 개념은
 * 시간표 셀 전용) comparator를 공유하지 않고 같은 규칙만 따른다.
 *
 * 섹션 4개:
 *  · active   = 그 날짜 수강 대상(입력 가능). 라벨 없음(기본 명단).
 *  · makeup   = 보강(수업외) — 수강행 없이 그날 출결이 있는 학생. 입력 가능.
 *  · withdrawn= 유예(30일) 안에 수강이 끝난 학생 — grid의 `endedOn`이 있는 행. 읽기 전용.
 *  · record   = 그 외 비eligible인데 기록(마크만 등)이 있어 남은 행. 읽기 전용.
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
  /** 수강 종료일(YYYY-MM-DD) — 있으면 '퇴원' 섹션. */
  endedOn?: string | null;
};

export type RosterGroupKey = "active" | "makeup" | "withdrawn" | "record";

export type RosterGroup<T> = {
  key: RosterGroupKey;
  /** 섹션 라벨(null=기본 명단, 라벨 행 없음). */
  label: string | null;
  rows: T[];
};

const GROUP_LABEL: Record<RosterGroupKey, string | null> = {
  active: null,
  makeup: "보강",
  withdrawn: "퇴원",
  record: "기록",
};

function groupOf(row: OrderableRosterRow): RosterGroupKey {
  if (row.eligible) return "active";
  if (row.isMakeup) return "makeup";
  return row.endedOn ? "withdrawn" : "record";
}

/**
 * 섹션별로 나눠 정렬한다. **빈 섹션은 반환하지 않는다**(라벨만 뜨는 빈 구역 방지).
 * `nameOf`는 학생 표시 이름(없으면 빈 문자열) — 이름을 모르면 id 순으로 안정 정렬된다.
 */
export function groupRosterRows<T extends OrderableRosterRow>(
  roster: readonly T[],
  nameOf: (studentId: string) => string,
): RosterGroup<T>[] {
  const buckets: Record<RosterGroupKey, T[]> = { active: [], makeup: [], withdrawn: [], record: [] };
  for (const row of roster) buckets[groupOf(row)].push(row);

  const byName = (a: T, b: T) => {
    const cmp = nameOf(a.studentId).localeCompare(nameOf(b.studentId), "ko");
    return cmp !== 0 ? cmp : a.studentId.localeCompare(b.studentId);
  };
  buckets.active.sort(byName);
  buckets.makeup.sort(byName);
  buckets.record.sort(byName);
  // 퇴원은 최신순(그만둔 지 얼마 안 된 학생이 위) — 시간표 셀과 같은 규칙.
  buckets.withdrawn.sort((a, b) => {
    const cmp = (b.endedOn ?? "").localeCompare(a.endedOn ?? "");
    return cmp !== 0 ? cmp : byName(a, b);
  });

  return (["active", "makeup", "withdrawn", "record"] as const)
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, label: GROUP_LABEL[key], rows: buckets[key] }));
}
