/**
 * 내신기간 — 순수 함수(원장 2026-10-20 *"전체목표에서는 내신기간때는 진도가 나가면 안됌 기간에서 제외하고
 * 내신기간이라는거 표시해줘야함"*). 원장이 준 표를 그대로 날짜로 옮겼다:
 *
 *   중1~중3 1학기 중간 4월 초 ~ 5월 초 · 1학기 기말 5월 말 ~ 7월 초
 *   중2~중3 2학기 중간 8월 말 ~ 10월 초 · 2학기 기말(중2) 11월 초 ~ 12월 초 · 중3 2학기 기말 10월 ~ 11월 초
 *
 * 🔑 '초' = 1~10일, '말' = 21일~말일로 읽는다(원장 표가 순 단위라 날짜는 이 규약 하나로 정한다).
 * 🔑 중3 2학기는 중간(8말~10초)과 기말(10월~11초)이 겹쳐 **한 덩어리**(8/21~11/10)로 합친다.
 * ⚠️ 학년은 매년 3월에 오른다 — 지금 학년에서 날짜의 학년도를 더해 그 날의 학년을 구한다.
 * ⚠️ 초등·고등은 표에 없어 내신기간이 없다(진도가 멈추지 않는다).
 */
export type ExamPeriod = { from: string; to: string; label: string };

const FIRST_TERM: [string, string, string][] = [
  ["04-01", "05-10", "1학기 중간"],
  ["05-21", "07-10", "1학기 기말"],
];
const BY_MIDDLE_GRADE: Record<number, [string, string, string][]> = {
  1: FIRST_TERM,
  2: [...FIRST_TERM, ["08-21", "10-10", "2학기 중간"], ["11-01", "12-10", "2학기 기말"]],
  3: [...FIRST_TERM, ["08-21", "11-10", "2학기 중간·기말"]],
};

/** 학년 문자열 → 통산 학년(초1=1 … 초6=6, 중1=7 … 중3=9, 고1=10 …). 못 읽으면 null. */
export function gradeOrdinal(grade: string | null | undefined): number | null {
  const m = grade?.trim().match(/^(초|중|고)\s*(\d)/);
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] === "초" ? n : m[1] === "중" ? 6 + n : 9 + n;
}

/** 학년도 — 3월부터 새 학년(1·2월은 앞 해 학년도). */
export function schoolYearOf(date: string): number {
  const y = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 3 ? y : y - 1;
}

/** 오늘 학년이 `ordinalNow`인 학생의 `date` 시점 통산 학년. */
export function ordinalOn(ordinalNow: number, today: string, date: string): number {
  return ordinalNow + schoolYearOf(date) - schoolYearOf(today);
}

/** `from`~`to`와 겹치는 내신기간(날짜순). 학년을 모르면 빈 배열. */
export function examPeriodsBetween(ordinalNow: number | null, today: string, from: string, to: string): ExamPeriod[] {
  if (ordinalNow == null || from > to) return [];
  const out: ExamPeriod[] = [];
  for (let sy = schoolYearOf(from); sy <= schoolYearOf(to); sy++) {
    const ordinal = ordinalNow + sy - schoolYearOf(today);
    for (const [a, b, label] of BY_MIDDLE_GRADE[ordinal - 6] ?? []) {
      const p = { from: `${sy}-${a}`, to: `${sy}-${b}`, label: `중${ordinal - 6} ${label}` };
      if (p.to >= from && p.from <= to) out.push(p);
    }
  }
  return out;
}

export function examOn(periods: readonly ExamPeriod[], date: string): ExamPeriod | null {
  return periods.find((p) => p.from <= date && date <= p.to) ?? null;
}

/** 중3 11월 말 — 전체 목표의 마감(원장 *"그학생이 중3 11월말 까지"*). 고등이거나 학년을 모르면 null. */
export function middleSchoolDeadline(ordinalNow: number | null, today: string): string | null {
  if (ordinalNow == null || ordinalNow > 9) return null;
  return `${schoolYearOf(today) + (9 - ordinalNow)}-11-30`;
}
