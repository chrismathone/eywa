/**
 * 내신기간 — 순수 함수(원장 2026-10-20 *"전체목표에서는 내신기간때는 진도가 나가면 안됌 기간에서 제외하고
 * 내신기간이라는거 표시해줘야함"*). **기본표**는 원장이 준 표를 그대로 날짜로 옮겼다:
 *
 *   중1~중3 1학기 중간 4월 초 ~ 5월 초 · 1학기 기말 5월 말 ~ 7월 초
 *   중2~중3 2학기 중간 8월 말 ~ 10월 초 · 2학기 기말(중2) 11월 초 ~ 12월 초 · 중3 2학기 기말 10월 ~ 11월 초
 *
 * 🔑 '초' = 1~10일, '말' = 21일~말일로 읽는다.
 * 🔑 **학교마다 다르다**(원장 *"학교마다 내신기간이 다름 학교별로 내신기간 반영되게"*) — 학교 × 학년도 × 시험(1학기 중간 …)으로
 *    적어 둔 날짜(`school_exam_periods`)가 있으면 그 시험만 기본표를 덮는다. 안 적은 시험·학년도는 기본표.
 * 🔑 어느 시험을 보는지는 학년이 정한다(중1 = 1학기만, 중2·중3 = 넷). 겹치는 기간은 한 덩어리로 합친다
 *    (기본표의 중3 2학기 중간·기말 = 8/21~11/10).
 * ⚠️ 학년은 매년 3월에 오른다. 초등·고등은 내신기간이 없다(진도가 멈추지 않는다).
 */
export type ExamPeriod = { from: string; to: string; label: string };
export type ExamTerm = "1-mid" | "1-final" | "2-mid" | "2-final" | "2-final-3";
/** 학교가 적어 둔 시험 하나(그 학년도). 날짜는 `YYYY-MM-DD`. */
export type SchoolExamOverride = { schoolYear: number; term: ExamTerm; from: string; to: string };

export const EXAM_TERMS: { term: ExamTerm; label: string }[] = [
  { term: "1-mid", label: "1학기 중간" },
  { term: "1-final", label: "1학기 기말" },
  { term: "2-mid", label: "2학기 중간" },
  { term: "2-final", label: "2학기 기말" },
  // 중3 2학기 기말은 고입 일정 때문에 중2보다 빠르다 — 같은 학교라도 날짜가 달라 칸을 따로 둔다(적대적 리뷰 2026-10-20).
  { term: "2-final-3", label: "중3 2학기 기말" },
];
const LABEL = Object.fromEntries(EXAM_TERMS.map((t) => [t.term, t.label])) as Record<ExamTerm, string>;

/** 기본표 — 학년(중1~3)별 그 학년이 보는 시험과 월-일. */
const DEFAULTS: Record<number, [ExamTerm, string, string][]> = {
  1: [["1-mid", "04-01", "05-10"], ["1-final", "05-21", "07-10"]],
  2: [["1-mid", "04-01", "05-10"], ["1-final", "05-21", "07-10"], ["2-mid", "08-21", "10-10"], ["2-final", "11-01", "12-10"]],
  3: [["1-mid", "04-01", "05-10"], ["1-final", "05-21", "07-10"], ["2-mid", "08-21", "10-10"], ["2-final-3", "10-01", "11-10"]],
};

/** 그 학년이 그 학년도에 보는 기본 시험(학교 표 화면이 '기본값'으로 보여준다). */
export function defaultExam(middleGrade: number, schoolYear: number, term: ExamTerm): { from: string; to: string } | null {
  const hit = DEFAULTS[middleGrade]?.find(([t]) => t === term);
  return hit ? { from: `${schoolYear}-${hit[1]}`, to: `${schoolYear}-${hit[2]}` } : null;
}

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

/** `from`~`to`와 겹치는 내신기간(날짜순, 겹치면 합침). 학년을 모르면 빈 배열. */
export function examPeriodsBetween(
  ordinalNow: number | null,
  today: string,
  from: string,
  to: string,
  overrides: readonly SchoolExamOverride[] = [],
): ExamPeriod[] {
  if (ordinalNow == null || from > to) return [];
  const raw: ExamPeriod[] = [];
  for (let sy = schoolYearOf(from); sy <= schoolYearOf(to); sy++) {
    const middle = ordinalNow + sy - schoolYearOf(today) - 6;
    for (const [term] of DEFAULTS[middle] ?? []) {
      const own = overrides.find((o) => o.schoolYear === sy && o.term === term && o.from <= o.to);
      const d = own ?? defaultExam(middle, sy, term)!;
      raw.push({ from: d.from, to: d.to, label: `중${middle} ${LABEL[term].replace(/^중\d\s/, "")}` });
    }
  }
  raw.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const merged: ExamPeriod[] = [];
  for (const p of raw) {
    const last = merged[merged.length - 1];
    if (last && p.from <= last.to) {
      last.to = p.to > last.to ? p.to : last.to;
      // 같은 학기면 시험 이름만 잇고(`2학기 중간·기말`), 학기가 다르면 학기까지 적는다.
      const sem = p.label.match(/(\d학기)/)?.[1];
      last.label = `${last.label}·${sem && last.label.includes(sem) ? p.label.replace(/^중\d\s\d학기\s/, "") : p.label.replace(/^중\d\s/, "")}`;
    } else merged.push({ ...p });
  }
  return merged.filter((p) => p.to >= from && p.from <= to);
}

export function examOn(periods: readonly ExamPeriod[], date: string): ExamPeriod | null {
  return periods.find((p) => p.from <= date && date <= p.to) ?? null;
}

/** 중3 11월 말 — 전체 목표의 마감(원장 *"그학생이 중3 11월말 까지"*). 고등이거나 학년을 모르면 null. */
export function middleSchoolDeadline(ordinalNow: number | null, today: string): string | null {
  if (ordinalNow == null || ordinalNow > 9) return null;
  return `${schoolYearOf(today) + (9 - ordinalNow)}-11-30`;
}
