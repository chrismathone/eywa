/**
 * 성적의 **학기 축** — `년도 · 1학기/2학기` (원장 2026-09-22 선택: *"1학기 · 2학기"*).
 *
 * 🔑 왜 새 축인가: 기존 `operating_periods`(0189a)는 **월 단위 세션**(수업·출결·돈의 축)이라
 *    중간고사·기말고사가 붙을 자리가 아니다. 학원설정 `operations.terms`는 스키마만 있고 소비처가
 *    0이라(입력 UI도 숨김) 사실상 없다. 그래서 성적만의 얇은 축을 **코드 고정**으로 둔다 —
 *    학교 학기는 학원이 정하는 값이 아니다(운영 enum 하드코딩 금지 규칙의 대상이 아니다:
 *    CLAUDE.md *"시험유형은 운영 enum이 아니다"*와 같은 결).
 *
 * 🔴 **1·2월은 전년도 2학기다** — 2학기는 9/1에 시작해 이듬해 2월 말일에 끝난다. 달력 연도로 접으면
 *    1월에 연 화면이 "2027년 1학기"가 되어 방금 적은 기말고사가 사라진 것처럼 보인다.
 * ⚠️ 여기서 정하는 건 **라벨과 구간뿐**이다. 성적 행의 진짜 날짜는 `taken_on`(시험일)이 든다.
 */

export type Term = 1 | 2;

export const TERM_LABEL: Record<Term, string> = { 1: "1학기", 2: "2학기" };

export const TERM_OPTIONS: { value: string; label: string }[] = [
  { value: "1", label: TERM_LABEL[1] },
  { value: "2", label: TERM_LABEL[2] },
];

export function isTerm(v: unknown): v is Term {
  return v === 1 || v === 2;
}

/** 주소·폼의 문자열을 학기로. 모르는 값은 폴백(화면이 죽지 않게). */
export function normalizeTerm(raw: unknown, fallback: Term): Term {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  return isTerm(n) ? n : fallback;
}

/** 주소·폼의 문자열을 년도로. 2000~2100 밖이면 폴백. */
export function normalizeYear(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : fallback;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 학기 구간(양끝 포함) — 1학기 `3/1~8/31` · 2학기 `9/1~이듬해 2월 말일`(윤년 반영).
 * 명단·엑셀·기본 시험일이 전부 이 창을 쓴다.
 */
export function termWindow(year: number, term: Term): { start: string; end: string } {
  if (term === 1) return { start: `${year}-03-01`, end: `${year}-08-31` };
  const next = year + 1;
  return { start: `${year}-09-01`, end: `${next}-02-${pad(isLeap(next) ? 29 : 28)}` };
}

/**
 * 그 학기에 **실제로 도는 달** — 1학기 `3~8월`, 2학기 `9~12월 + 이듬해 1·2월`.
 * 월말평가처럼 달마다 치는 시험의 드롭다운이 이 목록을 그대로 쓴다(원장 2026-09-23).
 */
export function termMonths(term: Term): number[] {
  return term === 1 ? [3, 4, 5, 6, 7, 8] : [9, 10, 11, 12, 1, 2];
}

/**
 * 그 달을 고르면 **시험일을 그 달 안으로** 옮긴다 — 월은 시험일에서 도출하므로(`gradeMonthOf`)
 * 둘이 어긋날 자리를 만들지 않는다.
 * 🔑 오늘이 그 달이면 오늘, 아니면 **그 달 말일**(단 학기 밖으로는 안 나간다).
 */
export function monthAnchorDate(year: number, term: Term, month: number, todayIso: string): string {
  const { start, end } = termWindow(year, term);
  // 2학기의 1·2월은 **이듬해**다 — 연도를 안 옮기면 학기 밖으로 떨어져 폴백에 먹힌다.
  const y = term === 2 && month <= 2 ? year + 1 : year;
  if (todayIso.slice(0, 7) === `${y}-${pad(month)}` && todayIso >= start && todayIso <= end) {
    return todayIso;
  }
  const last = `${y}-${pad(month)}-${pad(daysInMonth(y, month))}`;
  return last < start ? start : last > end ? end : last;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 그 날짜가 속한 (년도, 학기). 1·2월은 **전년도 2학기**. */
export function defaultTermOf(todayIso: string): { year: number; term: Term } {
  const year = Number(todayIso.slice(0, 4));
  const month = Number(todayIso.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    // 날짜를 못 읽으면 판단하지 않는다(호출부가 kstToday를 넘긴다 — 여기까지 오면 버그).
    return { year: 2026, term: 1 };
  }
  if (month <= 2) return { year: year - 1, term: 2 };
  if (month <= 8) return { year, term: 1 };
  return { year, term: 2 };
}

/**
 * 명단 기준일 — 오늘이 그 학기 안이면 **오늘**, 아직 시작 전이면 시작일, 이미 지났으면 종료일.
 * 지난 학기를 열었을 때 "지금 재원생"이 아니라 **그 학기의 명단**이 서게 하는 자리다.
 */
export function rosterAnchorFor(year: number, term: Term, todayIso: string): string {
  const { start, end } = termWindow(year, term);
  if (todayIso < start) return start;
  if (todayIso > end) return end;
  return todayIso;
}

/** 기본 시험일 — 오늘을 학기 안으로 눌러 담는다(지난 학기를 열면 그 학기 끝날). */
export function defaultExamDate(year: number, term: Term, todayIso: string): string {
  return rosterAnchorFor(year, term, todayIso);
}

/** 년도 드롭다운 — 오늘이 속한 학기의 년도를 기준으로 뒤 `back`년, 앞 `forward`년. */
export function termYearOptions(todayIso: string, back = 3, forward = 1): number[] {
  const base = defaultTermOf(todayIso).year;
  const out: number[] = [];
  for (let y = base + forward; y >= base - back; y -= 1) out.push(y);
  return out;
}

export function termLabel(year: number, term: Term): string {
  return `${year}년 ${TERM_LABEL[term]}`;
}
