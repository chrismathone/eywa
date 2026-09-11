/**
 * 템플릿 관리 미리보기용 **예시 자료** — 그림 칸에 실제로 어떤 결과지가 들어가는지 강사가 보게(사용자 2026-09-11:
 * *"들어갑니다 말고 들어가야 할 것 같애 — 그래야 선생님이 뭔지 아닌지 볼 수 있지"*). 순수 모듈(Vitest로 모양 잠금).
 *
 * 🔴 **미리보기 한 곳 전용** — 학부모 글·카드(/r·PDF·ClassNote)에는 절대 쓰지 않는다. 화면이 '예시 자료'라고 적는다.
 * 🔑 받을 때와 같은 엄격 검사(contract.ts `IJW_SHAPES`)를 통과하는 모양이다 — 실제 결과지 부품이 그대로 그린다.
 * 🔑 숫자가 서로 맞는다(일별 합 = 합계, 푼 날 = 학습한 날, 품사 맞힘 합 = 정답) — 예시가 앞뒤 안 맞으면 부품이 틀려 보인다.
 */
import type { IjwExamResult, IjwStudy } from "./contract";

export type JjSample = { exam: IjwExamResult; study: IjwStudy };

/** 30학습일 동안 푼 문제 수(0 = 쉰 날) — 들쑥날쑥해야 일별 막대·평균선이 제 모양을 보인다. */
const DAILY_ANSWERS = [42, 58, 0, 36, 71, 64, 0, 0, 55, 48, 62, 0, 80, 44, 39, 0, 67, 52, 0, 73, 58, 61, 0, 46, 69, 0, 57, 63, 0, 84];
const FALLBACK_DATE = "2026-09-11";
const STUDENT = { id: "sample", name: "예시 학생", className: "예시 반" };

function ymdParts(ymd: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function shift(ymd: string, days: number): string {
  const [y, m, d] = ymdParts(ymd)!;
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** KST 벽시계 → ISO(UTC). */
function kstIso(ymd: string, hh: number, mm: number): string {
  const [y, m, d] = ymdParts(ymd)!;
  return new Date(Date.UTC(y, m - 1, d, hh - 9, mm)).toISOString();
}

/** 합계를 몫(비율)대로 나눈다 — 마지막 몫이 나머지를 받아 합이 늘 맞는다. */
function split(total: number, shares: readonly number[]): number[] {
  const out = shares.slice(0, -1).map((s) => Math.round(total * s));
  return [...out, total - out.reduce((a, b) => a + b, 0)];
}

export function jjSampleFor(date: string): JjSample {
  const to = ymdParts(date) ? date : FALLBACK_DATE;
  const from = shift(to, -(DAILY_ANSWERS.length - 1));
  const daily = DAILY_ANSWERS.map((answers, i) => ({
    day: shift(from, i),
    answers,
    correct: Math.round(answers * (0.74 + ((i * 7) % 17) / 100)),
    studyMs: answers * 14_000,
  }));
  const answers = daily.reduce((a, d) => a + d.answers, 0);
  const correct = daily.reduce((a, d) => a + d.correct, 0);

  const decks = [
    { deckId: "sample-u5", deck: "Unit 5 단어", share: 0.46, rate: 0.86 },
    { deckId: "sample-u4", deck: "Unit 4 단어", share: 0.34, rate: 0.8 },
    { deckId: "sample-core", deck: "필수 단어 800", share: 0.2, rate: 0.63 },
  ];
  const deckAnswers = split(answers, decks.map((d) => d.share));
  const pos = [
    { pos: "n", label: "명사", share: 0.46, rate: 0.86 },
    { pos: "v", label: "동사", share: 0.28, rate: 0.8 },
    { pos: "adj", label: "형용사", share: 0.18, rate: 0.74 },
    { pos: "adv", label: "부사", share: 0.08, rate: 0.55 },
  ];
  const posAnswers = split(answers, pos.map((p) => p.share));

  const study: IjwStudy = {
    student: STUDENT,
    from,
    to,
    totals: {
      answers,
      correct,
      accuracy: answers ? Math.round((correct / answers) * 100) : 0,
      studyMs: daily.reduce((a, d) => a + d.studyMs, 0),
      newWords: 64,
      activeDays: daily.filter((d) => d.answers > 0).length,
    },
    longTermWords: 318,
    seenWords: 540,
    daily,
    byDeck: decks.map((d, i) => ({
      deckId: d.deckId,
      deck: d.deck,
      answers: deckAnswers[i]!,
      correct: Math.round(deckAnswers[i]! * d.rate),
    })),
    byPos: pos.map((p, i) => ({
      pos: p.pos,
      label: p.label,
      answers: posAnswers[i]!,
      correct: Math.round(posAnswers[i]! * p.rate),
    })),
    weak: [
      { prompt: "[형] 필수의, 꼭 필요한", answer: "essential", wrongs: 5, answers: 8 },
      { prompt: "[동] 제출하다", answer: "submit", wrongs: 4, answers: 9 },
      { prompt: "[명] 환경", answer: "environment", wrongs: 4, answers: 10 },
      { prompt: "[부] 드디어, 마침내", answer: "finally", wrongs: 3, answers: 7 },
      { prompt: "[동] 비교하다", answer: "compare", wrongs: 3, answers: 8 },
    ],
    exams: [
      { attemptId: "sample-3", deckId: "sample-u5", deck: "Unit 5 단어 시험", examType: "regular", submittedAt: kstIso(to, 14, 40), total: 20, correct: 17, score: 85 },
      { attemptId: "sample-2", deckId: "sample-u4r", deck: "Unit 4 재시험", examType: "regular", submittedAt: kstIso(shift(to, -4), 15, 5), total: 20, correct: 18, score: 90 },
      { attemptId: "sample-1", deckId: "sample-mid", deck: "내신 대비 단어", examType: "exam", submittedAt: kstIso(shift(to, -11), 16, 20), total: 30, correct: 22, score: 73 },
    ],
  };

  const exam: IjwExamResult = {
    student: STUDENT,
    deck: { id: "sample-u5", name: "Unit 5 단어 시험", examType: "regular" },
    submittedAt: kstIso(to, 14, 40),
    elapsedMs: 372_000,
    total: 20,
    correct: 17,
    score: 85,
    classAvg: 78,
    overallAvg: 81,
    byPos: [
      { pos: "n", label: "명사", correct: 9, total: 10 },
      { pos: "v", label: "동사", correct: 5, total: 6 },
      { pos: "adj", label: "형용사", correct: 3, total: 4 },
    ],
    wrong: [
      { prompt: "[형] 필수의, 꼭 필요한", answer: "essential", typed: "esential" },
      { prompt: "[동] 제출하다", answer: "submit", typed: "sumit" },
      { prompt: "[명] 교복", answer: "school uniform", typed: "" },
    ],
  };

  return { exam, study };
}
