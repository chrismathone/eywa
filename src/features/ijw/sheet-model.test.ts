import { describe, expect, it } from "vitest";
import type { IjwExamResult, IjwStudy } from "./contract";
import {
  avgCompare,
  dailyChart,
  examHeadline,
  foldBarRows,
  kstMd,
  kstStamp,
  niceMax,
  periodDays,
  periodLabel,
  scoreBand,
  studyDeckRows,
  studyExamRows,
  studyKpis,
  toneOfPct,
  weakRows,
  wrongRows,
} from "./sheet-model";

const study = (over: Partial<IjwStudy> = {}): IjwStudy => ({
  student: { id: "jdw", name: "jdw", className: "A반" },
  from: "2026-08-13",
  to: "2026-09-11",
  totals: { answers: 400, correct: 300, accuracy: 75, studyMs: 3_600_000, newWords: 42, activeDays: 12 },
  longTermWords: 30,
  seenWords: 120,
  daily: [
    { day: "2026-09-09", answers: 10, correct: 8, studyMs: 60_000 },
    { day: "2026-09-10", answers: 0, correct: 0, studyMs: 0 },
    { day: "2026-09-11", answers: 169, correct: 120, studyMs: 600_000 },
  ],
  byDeck: [
    { deckId: "a", deck: "작은", answers: 5, correct: 5 },
    { deckId: "b", deck: "큰", answers: 50, correct: 20 },
  ],
  byPos: [],
  weak: [{ prompt: "[명] 교복", answer: "school uniform", wrongs: 3, answers: 5 }],
  exams: [],
  ...over,
});

const exam = (over: Partial<IjwExamResult> = {}): IjwExamResult => ({
  student: { id: "jdw", name: "jdw", className: "A반" },
  deck: { id: "d", name: "Unit 3", examType: "exam" },
  submittedAt: "2026-09-11T05:32:00.000Z",
  elapsedMs: 312_000,
  total: 20,
  correct: 18,
  score: 90,
  classAvg: 80,
  overallAvg: null,
  byPos: [],
  wrong: [
    { prompt: "[명] 교복", answer: "school uniform", typed: "" },
    { prompt: "[동] 돕다", answer: "aid", typed: "help" },
  ],
  ...over,
});

describe("날짜", () => {
  it("기간 날 수는 양 끝 포함 · 못 읽으면 0", () => {
    expect(periodDays("2026-08-13", "2026-09-11")).toBe(30);
    expect(periodLabel("2026-08-13", "2026-09-11")).toBe("8/13 ~ 9/11 · 30일");
    expect(periodLabel("", "2026-09-11")).toBe("—");
  });

  it("제출 시각은 KST로 — 자정을 넘기면 다음 날", () => {
    expect(kstStamp("2026-09-11T05:32:00.000Z")).toBe("9월 11일 14:32");
    expect(kstMd("2026-09-10T16:00:00.000Z")).toBe("9/11");
    expect(kstStamp("nope")).toBe("—");
  });
});

describe("막대 목록", () => {
  it("넘치면 앞 keep−1줄 + 그 외 N개 + 합계, 0인 줄은 뺀다", () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ label: `d${i}`, correct: 5, total: 10 }));
    const rows = foldBarRows([...items, { label: "빈", correct: 0, total: 0 }], 5);
    expect(rows.map((r) => r.label)).toEqual(["d0", "d1", "d2", "d3", "그 외 4개", "합계"]);
    expect(rows[4]).toMatchObject({ kind: "rest", correct: 20, total: 40, pct: 50, tone: "critical" });
    expect(rows[5]).toMatchObject({ kind: "sum", correct: 40, total: 80 });
  });

  it("한 줄이면 합계 줄이 없다 · 60% 미만만 빨강", () => {
    expect(foldBarRows([{ label: "x", correct: 6, total: 10 }], 5)).toEqual([
      { key: "i0", label: "x", correct: 6, total: 10, pct: 60, tone: "primary", kind: "item" },
    ]);
    expect(toneOfPct(59)).toBe("critical");
  });

  it("단어장별은 푼 수가 많은 순", () => {
    expect(studyDeckRows(study(), 5).map((r) => r.label)).toEqual(["큰", "작은", "합계"]);
  });
});

describe("학습 분석지 지표", () => {
  it("정답률·하루 평균·학습한 날 비율·장기기억 비율", () => {
    const k = studyKpis(study());
    expect(k).toMatchObject({
      hasAnswers: true,
      accuracy: 75,
      accuracyTone: "primary",
      answers: "400개",
      studyTime: "1시간",
      studyNote: "학습한 날 하루 평균 5분",
      activeDays: "12일",
      activeNote: "기간 30일 중 40%",
      longTermNote: "본 단어 120개 중 25%",
    });
    expect(k.activeRatio).toBeCloseTo(0.4);
    expect(k.longTermRatio).toBeCloseTo(0.25);
  });

  it("기록이 없으면 정답률을 지어내지 않는다", () => {
    const k = studyKpis(study({ totals: { answers: 0, correct: 0, accuracy: 0, studyMs: 0, newWords: 0, activeDays: 0 }, seenWords: 0 }));
    expect(k.hasAnswers).toBe(false);
    expect(k.studyNote).toBe("기간 중 학습 없음");
    expect(k.longTermNote).toBe("아직 본 단어 없음");
  });
});

describe("일별 학습량", () => {
  it("읽기 좋은 눈금", () => {
    expect([niceMax(169), niceMax(42), niceMax(3), niceMax(0)]).toEqual([200, 50, 3, 1]);
  });

  it("최고치 하나·학습한 날 평균·마지막 날에 맞춘 이름표", () => {
    const c = dailyChart(study().daily, 2, 2);
    expect(c.peak).toBe(169);
    expect(c.bars.map((b) => b.peak)).toEqual([false, false, true]);
    expect(c.avg).toBe(90); // (10 + 0 + 169) / 2 — 학습한 날로 나눈다
    expect(c.bars.map((b) => b.label)).toEqual(["9/9", null, "9/11"]);
    expect(c.bars[2]!.pct).toBeCloseTo(84.5);
  });

  it("기록이 없으면 평균선도 없다", () => {
    const c = dailyChart([{ day: "2026-09-11", answers: 0, correct: 0, studyMs: 0 }], 0, 5);
    expect([c.peak, c.avg, c.avgPct, c.note]).toEqual([0, null, null, "기간 중 학습 기록 없음"]);
  });
});

describe("자주 틀리는 단어 · 기간 중 시험", () => {
  it("틀림 / 푼 수", () => {
    expect(weakRows(study(), 5)).toEqual([{ key: "0", no: 1, prompt: "[명] 교복", answer: "school uniform", note: "3 / 5회" }]);
  });

  it("최신순 limit + 나머지 수 + 추이는 옛날 → 최근(2회 이상일 때만)", () => {
    const e = (id: string, score: number, at: string) => ({
      attemptId: id, deckId: "d", deck: `시험 ${id}`, examType: "regular", submittedAt: at, total: 20, correct: 10, score,
    });
    const s = study({ exams: [e("c", 50, "2026-09-11T01:00:00Z"), e("b", 80, "2026-09-05T01:00:00Z"), e("a", 70, "2026-09-01T01:00:00Z")] });
    const r = studyExamRows(s, 2);
    expect(r.rows.map((x) => [x.deck, x.typeLabel, x.date, x.score, x.tone])).toEqual([
      ["시험 c", "평시", "9/11", 50, "critical"],
      ["시험 b", "평시", "9/5", 80, "primary"],
    ]);
    expect(r.rest).toBe(1);
    expect(r.trend.map((p) => p.key)).toEqual(["a", "b", "c"]);
    expect(studyExamRows(study({ exams: [e("x", 90, "2026-09-11T01:00:00Z")] }), 5).trend).toEqual([]);
  });
});

describe("시험 결과지", () => {
  it("머리 — 점수·정답·구분·KST 제출·걸린 시간·평균 비교", () => {
    const h = examHeadline(exam());
    expect(h).toMatchObject({
      score: 90,
      tone: "primary",
      correctLine: "정답 18 / 20문항",
      typeLabel: "내신",
      submitted: "9월 11일 14:32",
      elapsed: "5분 12초",
    });
    expect(h.compares).toEqual([
      { label: "반 평균", value: "80점", note: "이 학생 +10점", tone: "positive" },
      { label: "전체 평균", value: "—", note: "비교할 응시자 없음", tone: "neutral" },
    ]);
    expect(examHeadline(exam({ elapsedMs: 5 * 86_400_000 })).elapsed).toBe("—");
  });

  it("평균 비교 — 낮으면 critical · 같으면 '평균과 같음'", () => {
    expect(avgCompare("반 평균", 70, 80.4)).toEqual({ label: "반 평균", value: "80점", note: "이 학생 -10점", tone: "critical" });
    expect(avgCompare("반 평균", 80, 80).note).toBe("평균과 같음");
  });

  it("점수 위치 — 있는 평균만 세로선 · 가장자리 이름표 정렬", () => {
    expect(scoreBand(90, 80, null)).toEqual({
      pct: 90,
      tone: "primary",
      align: "end",
      markers: [{ key: "class", label: "반 평균 80점", pct: 80, tone: "ink" }],
    });
    expect(scoreBand(10, null, 72.6).align).toBe("start");
    expect(scoreBand(55, null, null)).toMatchObject({ align: "center", tone: "critical", markers: [] });
  });

  it("다시 봐야 할 단어 — 안 낸 문항은 답 없음 · limit 뒤는 나머지 수", () => {
    const w = wrongRows(exam(), 1);
    expect(w).toEqual({ rows: [{ key: "0", no: 1, prompt: "[명] 교복", answer: "school uniform", typed: null }], rest: 1, total: 2 });
    expect(wrongRows(exam()).rows[1]!.typed).toBe("help");
  });
});
