/**
 * 원스크린 "작성 상태" 필터 — 전체 / 작성 / 미작성 (순수 판정).
 *
 * 28명 로스터에서 "아직 안 쓴 학생"만 추려 마저 쓰는 게 이 필터의 유일한 목적이다.
 * 판정 기준은 **학부모 문구(초안)** — 진도·점수가 아니라 실제로 학부모에게 나갈 문장이 있느냐다.
 * (발송 현황 보드의 3단계 미작성/작성중/발송완료와는 축이 다르다: 저긴 행 단위 진척, 여긴 학생 단위 "쓸 게 남았나".)
 *
 * ⚠️ **결석 행은 판정에서 뺀다.** 결석 행은 발송이 원천 차단돼(`isRowActionable(…,"send")`) 문구를 채워도
 *    학부모에게 나가지 않는다 — 그걸 '미작성'에 남기면 **끝낼 수 없는 할 일**이 목록에 영원히 박힌다
 *    (CLAUDE.md #77: 행동을 재촉하는 표시는 그 행동의 실제 게이트와 같은 조건이어야 한다).
 */

export type WriteFilter = "all" | "written" | "unwritten";

/** 판정에 필요한 행 최소 shape — 컴포넌트 타입에 묶이지 않게 좁게 받는다(테스트 용이). */
export type WriteRow = {
  /** 화면 state의 학부모 문구 초안. */
  draft?: string | null;
  /** 이 행 보고서가 저장/발송됨 — 문구는 이미 확정돼 있다. */
  sent?: boolean;
  /** 이 행(반)의 대상 날짜 출결 raw. "absent"면 발송 불가라 판정 제외. */
  attendanceRaw?: string | null;
};

/** 이 행이 판정 대상인가 — 결석(발송 불가) 행은 제외. */
export function isWriteTargetRow(row: WriteRow): boolean {
  return row.attendanceRaw !== "absent";
}

/** 행 1건이 '작성됨'인가 — 이미 저장/발송됐거나 문구 초안이 채워짐. */
export function isRowWritten(row: WriteRow): boolean {
  return row.sent === true || !!row.draft?.trim();
}

/**
 * 학생 1명이 '작성 완료'인가 — 판정 대상 행이 **전부** 작성됨.
 * 대상 행이 하나도 없으면(전 행 결석·행 자체가 없음) 쓸 게 남지 않았으므로 완료로 본다
 * (미작성 목록에 남겨 봐야 강사가 할 수 있는 일이 없다).
 */
export function isStudentWritten(rows: readonly WriteRow[]): boolean {
  return rows.filter(isWriteTargetRow).every(isRowWritten);
}

/** 이 학생을 필터가 통과시키는가. all=전부 통과. */
export function matchesWriteFilter(filter: WriteFilter, written: boolean): boolean {
  if (filter === "all") return true;
  return filter === "written" ? written : !written;
}

/**
 * 표시 목록 = 지금 필터에 맞는 학생 **∪ 고정(pinned)된 학생**.
 *
 * 🔴 고정이 없으면 **입력 중에 카드·행이 눈앞에서 사라진다**: '미작성'만 보는 중에 문구를 한 글자
 *    치는 순간 그 학생은 '작성'이 돼 목록에서 빠지고, 카드뷰는 선택이 다음 학생으로 튀며(다른 학생
 *    카드에 계속 타이핑), 표뷰는 편집 중인 textarea가 언마운트돼 포커스와 남은 타이핑이 날아간다.
 *    그래서 필터를 **누른 시점의 대상**을 고정해 두고, 새로 조건에 맞게 된 학생(보강 추가 등)만 합집합으로 더한다.
 *    목록 정리는 사용자가 필터를 다시 누를 때(=pinned 재계산) 일어난다.
 */
export function applyWriteFilter<T extends { id: string }>(
  students: readonly T[],
  filter: WriteFilter,
  writtenById: Readonly<Record<string, boolean>>,
  pinnedIds: ReadonlySet<string>,
): T[] {
  if (filter === "all") return [...students];
  return students.filter(
    (s) => pinnedIds.has(s.id) || matchesWriteFilter(filter, writtenById[s.id] === true),
  );
}

/** 필터에 맞는 학생 수(고정 무시) — 토글 버튼 옆 실시간 카운트. */
export function countByWriteFilter<T extends { id: string }>(
  students: readonly T[],
  filter: Exclude<WriteFilter, "all">,
  writtenById: Readonly<Record<string, boolean>>,
): number {
  return students.filter((s) => matchesWriteFilter(filter, writtenById[s.id] === true)).length;
}
