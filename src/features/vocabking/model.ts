/**
 * **보카킹 종합평가 리포트** 값 만들기(순수) — 인재원 결과지(설명서 3번) + 최근 학습(4번) + 같은 시험 응시자(6번)
 * + aywa 학년 → 리포트 화면이 그대로 그릴 값. 원장 2026-10-07 *"데이터 없음 빼고 일단 다 넣어서 구현"*.
 *
 * 구조(원장이 정한 5단): ① 현재 학습 위치 → ② 어휘 역량 → ③ 어휘 세부 → ④ 강점·보완 포인트 → ⑤ 다음 학습 방향 (+ 학습 습관).
 * 🔴 **데이터가 없는 칸은 만들지 않는다**: 동일 수준 평균 · 문맥 이해 · 축별 학년 평균 · 추정 어휘량 · 유사어 혼동.
 * 🔴 문장은 숫자에서만(창작 금지). 재료가 없으면 그 값은 null이고 화면이 그 줄·블록을 감춘다.
 * 🔴 총 응시 인원은 화면에 쓰지 않는다(원장 *"1위 옆에 총원 몇명인지는 지워줘"*) — 상위 %를 내는 데만 쓴다.
 */
import type { IjwExamResult, IjwStudy } from "@/features/ijw/contract";
import { MIN_GRADE_PEERS, pointsToNextLevel, rankBand, scoreLevel, topPercentOf } from "./bands";
import { summarizeMistakes, type MistakeSummary } from "./spelling";
import { nextSteps, strengths } from "./advice";

export type VocabkingPeer = { ijwId: string; score: number; elapsedMs: number; grade: string | null };

export type VocabkingInput = {
  exam: IjwExamResult;
  /** 최근 30학습일 기록. 못 받았으면 null(습관·자주 틀리는 단어 블록이 빠진다). */
  study: IjwStudy | null;
  student: { name: string; grade: string | null };
  /** 같은 시험 응시자(학생마다 한 건, 학년은 aywa 짝에서). 못 받았으면 null. */
  peers: VocabkingPeer[] | null;
};

export type Comparison = { key: "class" | "overall" | "grade"; label: string; avg: number; diff: number };
export type RateRow = { key: "total" | "objective" | "subjective"; label: string; correct: number; total: number; rate: number };

export type VocabkingReport = {
  header: { name: string; grade: string | null; date: string; deckName: string };
  score: { score: number; correct: number; total: number };
  position: {
    rank: number | null;
    topPercent: number | null;
    band: string | null;
    level: { level: number; label: string };
    comparisons: Comparison[];
  };
  competency: RateRow[];
  details: {
    longTermWords: number | null;
    seenWords: number | null;
    elapsedMs: number;
    peerAvgElapsedMs: number | null;
  };
  mistakes: MistakeSummary;
  weakWords: { prompt: string; answer: string; wrongs: number; answers: number }[];
  strengths: string[];
  nextSteps: { title: string; body: string }[];
  /** `accuracy`는 인재원 값 그대로 **퍼센트(0~100)**. */
  habits: { activeDays: number; days: number; studyMs: number; newWords: number; accuracy: number; daily: { day: string; answers: number }[] } | null;
};

const KIND_LABEL: Record<string, string> = { objective: "의미 이해", subjective: "철자 정확도" };

export function kstDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const gradeKey = (g: string | null) => (g ?? "").replace(/\s/g, "");

export function buildVocabkingReport(input: VocabkingInput): VocabkingReport {
  const { exam, study, student } = input;
  const overall = exam.rank?.overall ?? null;
  const topPercent = overall ? topPercentOf(overall.rank, overall.of) : null;

  // 비교 — 반·전체 평균은 인재원이 준다, 학년 평균은 같은 시험 응시자 중 같은 학년(나 빼고)이 충분할 때만.
  const comparisons: Comparison[] = [];
  if (exam.classAvg !== null) comparisons.push({ key: "class", label: "반 평균 대비", avg: exam.classAvg, diff: exam.score - exam.classAvg });
  const others = (input.peers ?? []).filter((p) => p.ijwId !== exam.student.id);
  const sameGrade = student.grade ? others.filter((p) => gradeKey(p.grade) === gradeKey(student.grade)) : [];
  if (student.grade && sameGrade.length >= MIN_GRADE_PEERS) {
    const g = Math.round(avg(sameGrade.map((p) => p.score))!);
    comparisons.push({ key: "grade", label: `학년(${student.grade}) 평균 대비`, avg: g, diff: exam.score - g });
  }
  if (exam.overallAvg !== null) comparisons.push({ key: "overall", label: "전체 평균 대비", avg: exam.overallAvg, diff: exam.score - exam.overallAvg });

  const competency: RateRow[] = [];
  if (exam.total > 0) competency.push({ key: "total", label: "어휘 정답률", correct: exam.correct, total: exam.total, rate: exam.correct / exam.total });
  for (const k of exam.byKind ?? []) {
    if ((k.kind === "objective" || k.kind === "subjective") && k.total > 0) {
      competency.push({ key: k.kind, label: KIND_LABEL[k.kind]!, correct: k.correct, total: k.total, rate: k.correct / k.total });
    }
  }

  const peerTimes = others.map((p) => p.elapsedMs).filter((ms) => ms > 0);
  const mistakes = summarizeMistakes(exam.wrong);
  const habits = study
    ? {
        activeDays: study.totals.activeDays,
        days: study.daily.length,
        studyMs: study.totals.studyMs,
        newWords: study.totals.newWords,
        accuracy: study.totals.accuracy,
        daily: study.daily.map((d) => ({ day: d.day, answers: d.answers })),
      }
    : null;
  const level = scoreLevel(exam.score);
  const report: VocabkingReport = {
    header: { name: student.name, grade: student.grade, date: kstDate(exam.submittedAt), deckName: exam.deck.name },
    score: { score: exam.score, correct: exam.correct, total: exam.total },
    position: {
      rank: overall?.rank ?? null,
      topPercent,
      band: topPercent !== null ? rankBand(topPercent) : null,
      level: { level: level.level, label: level.label },
      comparisons,
    },
    competency,
    details: {
      longTermWords: study?.longTermWords ?? null,
      seenWords: study?.seenWords ?? null,
      elapsedMs: exam.elapsedMs,
      peerAvgElapsedMs: peerTimes.length >= MIN_GRADE_PEERS ? Math.round(avg(peerTimes)!) : null,
    },
    mistakes,
    weakWords: (study?.weak ?? []).slice(0, 5),
    strengths: [],
    nextSteps: [],
    habits,
  };
  report.strengths = strengths(report);
  report.nextSteps = nextSteps(report, pointsToNextLevel(exam.score));
  return report;
}
