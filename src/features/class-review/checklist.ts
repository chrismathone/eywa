// 수업 평가 체크리스트(참관) — 원장 시트 "INJAEWON · 수업 상향화 체크리스트" 이식(2026-08-04 초안).
// 6영역 × 5문항 = 30문항, 4점 척도(1 미흡 / 2 기준 이하 / 3 기준 충족 / 4 우수).
// 계산은 전부 이 순수 모듈이 단일 소스(Vitest) — 화면·저장은 결과만 소비한다.

export const SCALE_MIN = 1;
export const SCALE_MAX = 4;

export type ChecklistArea = { key: string; title: string; items: string[] };

/** 시트 원문 문항(2026-08-04 캡처 기준). 문구 수정은 원장 시트가 진실 — 여기만 고치면 화면·집계가 따라온다. */
export const CHECKLIST_AREAS: ChecklistArea[] = [
  {
    key: "prep",
    title: "① 수업 준비 및 운영",
    items: [
      "수업 전 교재·PPT·자료 등 모든 준비를 완료하여, 수업 중 교실을 이탈하지 않고 충실히 수업을 진행하였다.",
      "수업 시작·마무리 시간, 숙제 안내, 지난 시간 복습 및 이번 시간 수업 목표를 명확히 안내하였다.",
      "정시에 수업을 시작하였다.",
      "정시에 수업을 종료하였다.",
      "진도를 계획대로 마쳤다.",
    ],
  },
  {
    key: "delivery",
    title: "② 설명력 및 전달력",
    items: [
      "핵심 개념을 이해하기 쉽게 설명하였다.",
      "적절한 예시를 활용하였다.",
      "판서 구성이 이해하기 쉬웠다.",
      "강의 내용이 명확하게 전달되었다.",
      "학생의 이해도를 수시로 확인하였다.",
    ],
  },
  {
    key: "engagement",
    title: "③ 학생의 참여도",
    items: [
      "학생들이 수업에 집중하였다.",
      "학생들이 과제를 해 왔다.",
      "해당 진도 문제를 대부분 풀고 채점했으며, 공부한 흔적이 명확하다.",
      "노트 필기와 오답노트를 체계적으로 작성·활용하고 있다. (3색 형광펜 사용 등)",
      "학생들이 수업 내용을 하브루타 방식으로 정리할 시간이 적절히 운영되고 있다.",
    ],
  },
  {
    key: "feedback",
    title: "④ 개별관리 및 피드백",
    items: [
      "전체 수업 진행 속도를 학생들의 이해 수준에 맞춰 조절하였다.",
      "교실을 순회하며 학생 개개인에게 피드백을 제공하였다.",
      "학습이 느린 학생에게 추가 설명과 개별 지도를 제공하였다.",
      "학생 수준에 따라 문제 난이도와 과제를 다르게 배분하였다.",
      "숙제를 검사하고 학생에게 명확한 피드백을 제공하였다.",
    ],
  },
  {
    key: "assessment",
    title: "⑤ 형성평가 및 정기평가 운영",
    items: [
      "수업 시작 전까지 당일 모든 수업의 시험지와 답지가 준비되었다.",
      "시험지가 기본 형식을 갖췄다. (날짜, 범위, 담임, 난이도 등의 항목)",
      "시험이 타당도를 갖추었다. (측정하려는 학습 내용을 제대로 담고 있다.)",
      "시험이 신뢰도를 갖추었다. (문제가 명확하고 일관되게 채점될 수 있다.)",
      "틀린 문제에 대한 정확한 피드백과 오답 관리가 이루어지고 있다. (시험지 위주)",
    ],
  },
  {
    key: "attitude",
    title: "⑥ 교수자의 태도 및 전문성",
    items: [
      "학생을 존중하는 언어와 태도를 유지하였다.",
      "감정을 절제하며 수업을 운영하였다.",
      "담당 학생들의 성장과 수업의 특징을 SNS에 친절하고 긍정적으로 소개하였다.",
      "수업 분위기를 긍정적으로 이끌었다.",
      "강사로서 자신감과 전문성이 느껴졌다.",
    ],
  },
];

export const TOTAL_ITEMS = CHECKLIST_AREAS.reduce((n, a) => n + a.items.length, 0); // 30
export const MAX_TOTAL = TOTAL_ITEMS * SCALE_MAX; // 120

/**
 * 종합 등급 컷(환산 100점 기준) — 원장 시트 수식 그대로(2026-08-04 확정):
 * =IF(>=95,"S",IF(>=90,"A+",IF(>=85,"A",IF(>=80,"B+",IF(>=75,"B",IF(>=70,"C","재참관"))))))
 */
export const GRADE_CUTS: { min: number; grade: string }[] = [
  { min: 95, grade: "S" },
  { min: 90, grade: "A+" },
  { min: 85, grade: "A" },
  { min: 80, grade: "B+" },
  { min: 75, grade: "B" },
  { min: 70, grade: "C" },
];
export const GRADE_FALLBACK = "재참관";

export function gradeOf(percent: number): string {
  for (const c of GRADE_CUTS) if (percent >= c.min) return c.grade;
  return GRADE_FALLBACK;
}

/** 한 사람의 채점 한 장 — scores[i]는 1~4, 0/결측은 미입력. */
export type ScoreSheet = {
  scores: number[]; // length 30 (부족하면 미입력 취급)
  comment?: string;
  submittedAt?: string;
};

export type SheetTotals = {
  /** 영역별 소계(입력된 문항 합) */
  areaSubtotals: number[];
  answered: number;
  total: number;
  /** 환산 100점(소수 1자리). 전 문항 입력 기준 총점/120 — 미입력은 0점 취급(시트와 동일). */
  percent: number;
  grade: string;
  complete: boolean;
};

/** 점수 정규화 — 1~4 정수만 인정, 그 외 0(미입력). */
export function normalizeScore(v: unknown): number {
  const n = typeof v === "number" ? Math.trunc(v) : Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) && n >= SCALE_MIN && n <= SCALE_MAX ? n : 0;
}

export function computeTotals(sheet: Pick<ScoreSheet, "scores"> | null | undefined): SheetTotals {
  const raw = sheet?.scores ?? [];
  const areaSubtotals: number[] = [];
  let idx = 0;
  let total = 0;
  let answered = 0;
  for (const area of CHECKLIST_AREAS) {
    let sub = 0;
    for (let i = 0; i < area.items.length; i++, idx++) {
      const v = normalizeScore(raw[idx]);
      if (v > 0) answered++;
      sub += v;
    }
    areaSubtotals.push(sub);
    total += sub;
  }
  const percent = Math.round((total / MAX_TOTAL) * 1000) / 10;
  return {
    areaSubtotals,
    answered,
    total,
    percent,
    grade: gradeOf(percent),
    complete: answered === TOTAL_ITEMS,
  };
}

/** 여러 장의 평균(제출된 장만) — 상세 화면 '평균' 열. 장이 없으면 null. */
export function averageTotals(sheets: ScoreSheet[]): SheetTotals | null {
  const done = sheets.filter((s) => computeTotals(s).answered > 0);
  if (done.length === 0) return null;
  const avgScores: number[] = [];
  for (let i = 0; i < TOTAL_ITEMS; i++) {
    const vals = done.map((s) => normalizeScore(s.scores[i])).filter((v) => v > 0);
    avgScores.push(vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0);
  }
  // 평균 점수는 소수라 normalize를 다시 태우지 않고 직접 합산한다.
  const areaSubtotals: number[] = [];
  let idx = 0;
  let total = 0;
  for (const area of CHECKLIST_AREAS) {
    let sub = 0;
    for (let i = 0; i < area.items.length; i++, idx++) sub += avgScores[idx];
    areaSubtotals.push(Math.round(sub * 10) / 10);
    total += sub;
  }
  total = Math.round(total * 10) / 10;
  const percent = Math.round((total / MAX_TOTAL) * 1000) / 10;
  return { areaSubtotals, answered: TOTAL_ITEMS, total, percent, grade: gradeOf(percent), complete: true };
}
