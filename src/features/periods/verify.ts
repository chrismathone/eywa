// 세션 모양 검산 — 순수 함수(Vitest 강제).
//
// 원장 정의(2026-08-07): *"세션의 목적은 월~금을 각 4회로 맞추는 것에 목적이 있음.
// 주말은 그 사이에 그냥 이어지지만 세션의 일부로 계산하는 게 편하므로 세션에 편입시키는 것임."*
// → 공휴일로 어떤 요일이 빠지면 **다음 달로 넘어가서라도** 그 요일을 4회 채운다.
//   그래서 "2월 세션이 3/5까지" 같은 일이 정상이다.
//
// 🔴 이 모듈은 **경고만 한다. 절대 자동으로 고치지 않는다.**
//    학원 사정으로 일부러 3회인 달이 있을 수 있고(방학·휴원), 그걸 코드가 4회로 늘리면
//    사람이 정한 기간을 기계가 뒤집는 셈이 된다. 저장은 사람이 본 값 그대로 된다.
// 🔴 자동 생성(suggestEndDate)도 **입력 보조**일 뿐이다 — 법정공휴일과 학원 휴원일은 다르므로
//    제안값이 실제 운영과 어긋날 수 있다(2026-08-07 실측: 법정공휴일만으로는 연간계획표 재현 실패).

/** 월=1 … 금=5. 주말은 세션에 편입되지만 회차 계산 대상이 아니다. */
export const TEACHING_DOW = [1, 2, 3, 4, 5] as const;
export type TeachingDow = (typeof TEACHING_DOW)[number];

export const DEFAULT_TARGET_PER_DOW = 4;

const DOW_LABEL: Record<TeachingDow, string> = { 1: "월", 2: "화", 3: "수", 4: "목", 5: "금" };

function dowOf(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** 구간 안에서 요일별 수업일 수(공휴일 제외). 주말은 세지 않는다. */
export function countTeachingDays(
  start: string,
  end: string,
  holidays: readonly string[] = [],
): Record<TeachingDow, number> {
  const counts: Record<TeachingDow, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  if (!isYmd(start) || !isYmd(end) || start > end) return counts;
  const skip = new Set(holidays);
  let cur = start;
  for (let guard = 0; cur <= end && guard < 400; guard++) {
    const dow = dowOf(cur);
    if (dow >= 1 && dow <= 5 && !skip.has(cur)) counts[dow as TeachingDow]++;
    cur = addDays(cur, 1);
  }
  return counts;
}

/**
 * 시작일부터 월~금이 각 target회가 되는 **마지막 수업일**. 입력 보조 전용.
 * 채우지 못하면(가드 초과) null — 호출부가 "제안 불가"로 처리한다.
 */
export function suggestEndDate(
  start: string,
  holidays: readonly string[] = [],
  target = DEFAULT_TARGET_PER_DOW,
): string | null {
  if (!isYmd(start) || target < 1) return null;
  const skip = new Set(holidays);
  const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let cur = start;
  let last: string | null = null;
  for (let guard = 0; guard < 400; guard++) {
    const dow = dowOf(cur);
    if (dow >= 1 && dow <= 5 && !skip.has(cur) && counts[dow] < target) {
      counts[dow]++;
      last = cur;
      if (TEACHING_DOW.every((d) => counts[d] >= target)) return last;
    }
    cur = addDays(cur, 1);
  }
  return null;
}

export type PeriodShapeCheck = {
  /** 부족한 요일이 없으면 true. **넘침은 ok를 깨뜨리지 않는다**(아래 설명). */
  ok: boolean;
  counts: Record<TeachingDow, number>;
  /** 목표에 **못 미치는** 요일이 있을 때만 채워지는 경고. */
  warning: string | null;
  /** 목표를 **넘는** 요일 설명(경고가 아니라 사실 안내). */
  note: string | null;
  /** 부족한 요일(라벨). */
  shortDows: string[];
  /** 넘치는 요일(라벨). */
  overDows: string[];
};

/**
 * 저장 전 인라인 안내용. **어떤 경우에도 저장은 허용한다.**
 *
 * 🔴 **넘침은 결함이 아니다.** 공휴일로 어떤 요일이 빠지면 그 요일을 4회 채우려고 기간을 늘려야 하는데,
 *    그 사이 다른 요일은 자연히 5회가 된다 — 즉 공휴일이 낀 달에는 "월~금 모두 정확히 4회"가
 *    **수학적으로 성립하지 않는다**. 원장이 든 실제 예(2월 세션 2/2~3/5)도 목요일이 5회다.
 *    2026-08-07 실화면 검증에서 '빈 달 이어서 채우기'가 만든 6·7월 구간이 자기 검산에 걸린 게 이 때문이다.
 *    → 부족만 경고(주황)하고, 넘침은 회색 설명으로 내린다.
 * 메시지는 한글 — raw 코드·영문 enum을 화면에 내보내지 않는다.
 */
export function verifyPeriodShape(
  start: string,
  end: string,
  holidays: readonly string[] = [],
  target = DEFAULT_TARGET_PER_DOW,
): PeriodShapeCheck {
  const counts = countTeachingDays(start, end, holidays);
  const detail = TEACHING_DOW.map((d) => `${DOW_LABEL[d]} ${counts[d]}`).join(" · ");
  const shortDows = TEACHING_DOW.filter((d) => counts[d] < target).map((d) => DOW_LABEL[d]);
  const overDows = TEACHING_DOW.filter((d) => counts[d] > target).map((d) => DOW_LABEL[d]);

  return {
    ok: shortDows.length === 0,
    counts,
    shortDows,
    overDows,
    warning:
      shortDows.length > 0
        ? `${shortDows.join("·")}요일이 ${target}회에 못 미칩니다 (${detail}). 휴원일 설정을 확인하거나, 의도한 기간이면 그대로 저장하세요.`
        : null,
    note:
      shortDows.length === 0 && overDows.length > 0
        ? `${overDows.join("·")}요일 ${target + 1}회 — 공휴일을 채우느라 늘어난 구간입니다 (${detail})`
        : null,
  };
}

/**
 * 인접 세션 사이에 낀 **수업일**(주말·공휴일 제외). 비어 있으면 알릴 것이 없다.
 * 주말만 뜨는 틈(금요일 끝 → 다음 월요일 시작)은 정상이라 경고하지 않는다.
 */
export function findTeachingGapDays(
  prevEnd: string,
  nextStart: string,
  holidays: readonly string[] = [],
): string[] {
  const skip = new Set(holidays);
  return findGapDays(prevEnd, nextStart).filter((d) => {
    const dow = dowOf(d);
    return dow >= 1 && dow <= 5 && !skip.has(d);
  });
}

/** 인접 세션 사이의 빈 날(어느 세션에도 안 속하는 날). 저장 전 경고용. */
export function findGapDays(
  prevEnd: string,
  nextStart: string,
): string[] {
  if (!isYmd(prevEnd) || !isYmd(nextStart)) return [];
  const out: string[] = [];
  let cur = addDays(prevEnd, 1);
  for (let guard = 0; cur < nextStart && guard < 400; guard++) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}
