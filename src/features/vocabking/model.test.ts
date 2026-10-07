import { describe, expect, it } from "vitest";
import type { IjwExamResult, IjwStudy } from "@/features/ijw/contract";
import { pointsToNextLevel, rankBand, scoreLevel, topPercentOf } from "./bands";
import { buildVocabkingReport, kstDate, type VocabkingPeer } from "./model";
import { classifySpelling, isSpellingItem, summarizeMistakes } from "./spelling";

/** 실제 저장된 보카킹 결과지 모양(테스트 학생 '학원이', 2026-09-17 '[보카킹] 26년 9월') — 틀린 문항은 앞부분만. */
const EXAM: IjwExamResult = {
  attemptId: "a1",
  rank: { overall: { rank: 1, of: 88 }, class: null },
  byKind: [
    { kind: "objective", label: "객관식", correct: 91, total: 100 },
    { kind: "subjective", label: "주관식", correct: 80, total: 100 },
  ],
  classCount: 4,
  overallCount: 88,
  student: { id: "학원이", name: "학원이", className: "테스터 그룹" },
  deck: { id: "d1", name: "[보카킹] 26년 9월", examType: "regular" },
  submittedAt: "2026-09-17T08:17:37.252Z",
  elapsedMs: 1777252,
  total: 200,
  correct: 171,
  score: 86,
  classAvg: 20,
  overallAvg: 61,
  byPos: [{ pos: "기타", label: "기타", correct: 171, total: 200 }],
  wrong: [
    { prompt: "go to school", answer: "학교에 다니다", typed: "학교를 졸업하다" },
    { prompt: "helpful", answer: "도움이 되는", typed: "방해가 되는" },
    { prompt: "on the other hand", answer: "반면에", typed: "게다가" },
    { prompt: "장학금", answer: "scholarship", typed: "scholarshpi" },
    { prompt: "신문", answer: "newspaper", typed: "newspapre" },
    { prompt: "교통, 교통 수단", answer: "transportation", typed: "transportatino" },
    { prompt: "음악가, 연주가", answer: "musician", typed: "musicina" },
    { prompt: "빙하", answer: "glacier", typed: "glacire" },
  ],
};

const STUDY: IjwStudy = {
  student: { id: "학원이", name: "학원이", className: "테스터 그룹" },
  from: "2026-08-30",
  to: "2026-09-28",
  totals: { answers: 1179, correct: 980, accuracy: 0.83, studyMs: 21_600_000, newWords: 240, activeDays: 21 },
  longTermWords: 412,
  seenWords: 960,
  daily: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, answers: i % 3 ? 40 : 0, correct: 30, studyMs: 600_000 })),
  byDeck: [],
  byPos: [],
  weak: [
    { prompt: "[명] 가사, 집안일", answer: "housework", wrongs: 6, answers: 7 },
    { prompt: "[형] 아주 맛있는", answer: "delicious", wrongs: 5, answers: 7 },
  ],
  exams: [],
};

const peers = (grade: string, n: number, score: number): VocabkingPeer[] =>
  Array.from({ length: n }, (_, i) => ({ ijwId: `${grade}-${i}`, score, elapsedMs: 1_500_000, grade }));

describe("철자 실수 유형 — 정답과 쓴 답만으로", () => {
  it("순서 바뀜·빠짐·더함·하나 틀림·여러 글자", () => {
    expect(classifySpelling("scholarship", "scholarshpi")).toBe("swap");
    expect(classifySpelling("chopsticks", "chopstics")).toBe("missing");
    expect(classifySpelling("glacier", "glacierr")).toBe("extra");
    expect(classifySpelling("counselor", "counseler")).toBe("oneLetter");
    expect(classifySpelling("glacier", "glacire")).toBe("swap"); // e↔r
    expect(classifySpelling("glacier", "gleeser")).toBe("several");
    expect(classifySpelling("glacier", "  ")).toBe("blank");
  });
  it("정답이 한글이면 뜻 문항", () => {
    expect(isSpellingItem("scholarship")).toBe(true);
    expect(isSpellingItem("be famous for …")).toBe(true);
    expect(isSpellingItem("...로 유명하다")).toBe(false);
  });
  it("요약 — 철자 5 · 긴 단어 3 · 뜻 3", () => {
    const m = summarizeMistakes(EXAM.wrong);
    expect(m.spellingTotal).toBe(5);
    expect(m.meaning).toBe(3);
    expect(m.longWords).toBe(3); // scholarship · newspaper · transportation
    expect(m.spelling[0]).toMatchObject({ kind: "swap", count: 5 }); // 이 학생의 철자 실수는 전부 이웃 글자 순서 바뀜
  });
});

describe("기준표", () => {
  it("상위 % · 구간 · 레벨", () => {
    expect(topPercentOf(1, 88)).toBe(2);
    expect(topPercentOf(0, 88)).toBeNull();
    expect(rankBand(2)).toBe("최상위권");
    expect(rankBand(55)).toBe("중위권");
    expect(scoreLevel(86)).toMatchObject({ level: 4, label: "고급" });
    expect(pointsToNextLevel(86)).toMatchObject({ gap: 4 });
    expect(pointsToNextLevel(95)).toBeNull();
  });
});

describe("리포트 — 실제 결과지 모양으로", () => {
  const r = buildVocabkingReport({
    exam: EXAM,
    study: STUDY,
    student: { name: "학원이", grade: "중1" },
    peers: [...peers("중1", 6, 60), ...peers("중2", 10, 70), { ijwId: "학원이", score: 86, elapsedMs: 1777252, grade: "중1" }],
  });
  it("① 위치 — 석차·상위 %·구간·레벨·비교(반 · 학년 · 전체)", () => {
    expect(r.position).toMatchObject({ rank: 1, topPercent: 2, band: "최상위권", level: { level: 4 } });
    expect(r.position.comparisons.map((c) => [c.key, c.diff])).toEqual([
      ["class", 66],
      ["grade", 26],
      ["overall", 25],
    ]);
  });
  it("총원은 값으로 들고 다니지 않는다(화면에 못 쓰게)", () => {
    expect(JSON.stringify(r.position)).not.toContain("88");
  });
  it("② 역량 — 정답률·의미(객관식)·철자(주관식) 3축만", () => {
    expect(r.competency.map((c) => [c.label, Math.round(c.rate * 100)])).toEqual([
      ["어휘 정답률", 86],
      ["의미 이해", 91],
      ["철자 정확도", 80],
    ]);
  });
  it("③ 세부 — 장기 기억·학습 단어·시간(나 빼고 응시자 평균)", () => {
    expect(r.details).toMatchObject({ longTermWords: 412, seenWords: 960, elapsedMs: 1777252, peerAvgElapsedMs: 1_500_000 });
  });
  it("④⑤ 강점·다음 학습 — 숫자에서만, 다음 목표는 마지막 칸", () => {
    expect(r.strengths[0]).toBe("전체 응시자 중 상위 2%입니다.");
    expect(r.strengths.join(" ")).toContain("의미 이해 91%");
    expect(r.nextSteps.map((s) => s.title)).toEqual(["철자 쓰기 연습", "뜻 구별 연습", "자주 틀리는 단어 복습", "다음 목표 Lv.5"]);
    expect(r.nextSteps[0]!.body).toContain("뜻은 알지만 쓰기에서 놓친 단어가 많습니다");
  });
  it("학년 인원이 모자라면 학년 비교를 빼고, 석차가 없으면 위치 칸을 비운다", () => {
    const thin = buildVocabkingReport({
      exam: { ...EXAM, rank: { overall: null, class: null } },
      study: null,
      student: { name: "학원이", grade: "중1" },
      peers: peers("중1", 3, 60),
    });
    expect(thin.position.comparisons.map((c) => c.key)).toEqual(["class", "overall"]);
    expect(thin.position).toMatchObject({ rank: null, topPercent: null, band: null });
    expect(thin.habits).toBeNull();
    expect(thin.details.longTermWords).toBeNull();
  });
  it("날짜는 KST", () => {
    expect(kstDate("2026-09-17T16:30:00Z")).toBe("2026-09-18");
  });
});
