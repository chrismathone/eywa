/**
 * EiE **월간 보고서**(Monthly Evaluation Report)의 점수 자리 — 순수 모듈(Vitest로 잠금).
 *
 * 원장 2026-11-05 *"eie는 시트의 월간 보고서와 일일보고서 두가지 종류로 나갈예정인데 월간 보고서 디자인은 해당 시트로
 * 동일하게"* — 시트(Yoojin T_EiE Monthly Evaluation Report)는 Writing·Speaking·Reading·Listening 네 영역의
 * 반 평균(Average)과 학생 점수(Student's score)를 막대 그래프 + 표로 싣고, 아래에 Teacher's Comment를 둔다.
 *
 * 🔑 점수는 글(`lesson_reports.notes`) 안의 **한 줄**로 동결한다 — `[월간평가 2026-10 | 만점 25 | W 20/23.5 | S …]`.
 *    그림 자리(`[시험결과지]`, image-slots.ts)와 같은 방식이라 저장 경로가 그대로이고, 보낸 뒤 성적을 고쳐도 학부모가 받은
 *    보고서는 바뀌지 않는다(인쇄물 동결 원칙). 재료는 성적관리 영어 Monthly Test의 영역 점수(`student_grades.area_scores`, s2_0023).
 * 🔑 평균 = 같은 반·같은 달 Monthly Test에서 **그 영역 점수가 있는 학생**의 평균(소수 한 자리).
 * 🔴 줄 **전체**가 이 모양일 때만 자리다 — 문장 속 글자는 그냥 글자.
 */
import { AREA_KEYS, areaMaxOf, parseAreas, type AreaKey } from "@/features/grades/area-scores";

/** 시트의 영역 순서(위 → 아래) = Writing · Speaking · Reading · Listening. */
export const MONTHLY_AREA_ORDER: readonly AreaKey[] = ["writing", "speaking", "reading", "listening"];

/** 학부모 카드의 영역 이름 — 시트 그대로 영어. */
export const MONTHLY_AREA_LABEL: Record<AreaKey, string> = {
  writing: "Writing",
  speaking: "Speaking",
  reading: "Reading",
  listening: "Listening",
};

const AREA_CODE: Record<AreaKey, string> = { writing: "W", speaking: "S", reading: "R", listening: "L" };

export type MonthlyAreaScore = { score: number | null; average: number | null };

export type MonthlyEval = {
  /** 시험 달 `YYYY-MM`. */
  month: string;
  /** 영역 만점(총합 만점 ÷ 4). */
  areaMax: number;
  areas: Record<AreaKey, MonthlyAreaScore>;
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: number | null) => (v == null ? "-" : String(v));

/** 글에 남는 한 줄. */
export function monthlyEvalMarker(ev: MonthlyEval): string {
  const parts = MONTHLY_AREA_ORDER.map((k) => `${AREA_CODE[k]} ${num(ev.areas[k].score)}/${num(ev.areas[k].average)}`);
  return `[월간평가 ${ev.month} | 만점 ${ev.areaMax} | ${parts.join(" | ")}]`;
}

const LINE = /^\[\s*월간평가\s+(\d{4}-\d{2})\s*\|\s*만점\s*([\d.]+)\s*\|(.+)\]$/;
const PART = /^([WSRL])\s+(-|[\d.]+)\s*\/\s*(-|[\d.]+)$/;

/** 이 줄이 월간 점수 자리면 그 값. 모양이 하나라도 어긋나면 null(글자로 남긴다). */
export function monthlyEvalOfLine(line: string): MonthlyEval | null {
  const m = LINE.exec(line.trim());
  if (!m) return null;
  const areaMax = Number(m[2]);
  if (!Number.isFinite(areaMax) || areaMax <= 0) return null;
  const byCode = new Map<string, MonthlyAreaScore>();
  for (const raw of m[3]!.split("|")) {
    const p = PART.exec(raw.trim());
    if (!p) return null;
    const val = (s: string) => (s === "-" ? null : Number(s));
    const score = val(p[2]!);
    const average = val(p[3]!);
    if ((score != null && !Number.isFinite(score)) || (average != null && !Number.isFinite(average))) return null;
    byCode.set(p[1]!, { score, average });
  }
  const areas = {} as Record<AreaKey, MonthlyAreaScore>;
  for (const k of AREA_KEYS) {
    const v = byCode.get(AREA_CODE[k]);
    if (!v) return null;
    areas[k] = v;
  }
  return { month: m[1]!, areaMax, areas };
}

/** 글에서 첫 월간 점수 자리. 없으면 null. */
export function monthlyEvalOfText(text: string | null | undefined): MonthlyEval | null {
  for (const line of (text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const ev = monthlyEvalOfLine(line);
    if (ev) return ev;
  }
  return null;
}

/** 성적 한 줄(영어 Monthly Test) — 로스터가 읽은 그대로. */
export type MonthlyGradeRow = {
  student_id: string;
  taken_on: string;
  max_score: number | string | null;
  area_scores: unknown;
};

/**
 * 한 반·한 달의 성적 줄들 → 그 학생의 월간 점수. 학생 점수가 하나도 없으면 null(그 줄이 글에서 빠진다).
 * 만점은 그 학생 줄의 총합 만점 ÷ 4 — 없으면 null(그래프 축을 지어내지 않는다).
 */
export function buildMonthlyEval(rows: readonly MonthlyGradeRow[], studentId: string, month: string): MonthlyEval | null {
  const mine = rows.find((r) => r.student_id === studentId);
  const mineAreas = mine ? parseAreas(mine.area_scores) : null;
  const totalMax = mine?.max_score == null ? NaN : Number(mine.max_score);
  if (!mine || !mineAreas || !Number.isFinite(totalMax) || totalMax <= 0) return null;
  const all = rows.map((r) => parseAreas(r.area_scores)).filter((a) => a != null);
  const areas = {} as Record<AreaKey, MonthlyAreaScore>;
  for (const k of AREA_KEYS) {
    const vals = all.map((a) => a[k]).filter((v): v is number => typeof v === "number");
    areas[k] = {
      score: mineAreas[k] ?? null,
      average: vals.length ? round1(vals.reduce((s, v) => s + v, 0) / vals.length) : null,
    };
  }
  return { month, areaMax: round1(areaMaxOf(totalMax)), areas };
}
