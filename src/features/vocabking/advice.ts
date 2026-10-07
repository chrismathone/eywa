/**
 * 보카킹 리포트 **④ 강점 · ⑤ 다음 학습 방향** 문장 규칙(순수). 숫자에서만 만든다(창작 금지).
 * 원장 정리안 *"'취약'보다 '다음 단계에서 무엇을 하면 좋은가'"* — 그래서 약점 문장이 아니라 연습 제안으로 적는다.
 * ⚠️ 문턱 숫자는 원장 확정 전 기본값(2026-10-07) — 바꿀 땐 이 파일의 상수만.
 */
import type { VocabkingReport } from "./model";
import type { SCORE_LEVELS } from "./bands";

const HIGH_RATE = 0.9;
const TOP_PERCENT_STRENGTH = 30;
const ABOVE_AVG_POINTS = 10;
const STEADY_DAYS = 15;
const PRACTICE_MIN = 3;
const KIND_GAP = 0.1;

const pct = (r: number) => `${Math.round(r * 100)}%`;

export function strengths(r: VocabkingReport): string[] {
  const out: string[] = [];
  if (r.position.topPercent !== null && r.position.topPercent <= TOP_PERCENT_STRENGTH) {
    out.push(`전체 응시자 중 상위 ${r.position.topPercent}%입니다.`);
  }
  for (const row of r.competency) {
    if (row.key !== "total" && row.rate >= HIGH_RATE) out.push(`${row.label} ${pct(row.rate)} — ${row.total}문제 중 ${row.correct}개를 맞혔습니다.`);
  }
  const overall = r.position.comparisons.find((c) => c.key === "overall");
  if (overall && overall.diff >= ABOVE_AVG_POINTS) out.push(`전체 평균(${overall.avg}점)보다 ${overall.diff}점 높습니다.`);
  if (r.habits && r.habits.activeDays >= STEADY_DAYS) out.push(`최근 ${r.habits.days}일 중 ${r.habits.activeDays}일 학습했습니다 — 학습 습관이 꾸준합니다.`);
  // 아무 문턱도 못 넘었어도 사실 한 줄은 남긴다(빈 강점 칸은 학부모에게 "강점이 없다"로 읽힌다).
  if (out.length === 0) out.push(`${r.score.total}문제 중 ${r.score.correct}개를 맞혔습니다.`);
  return out;
}

export function nextSteps(
  r: VocabkingReport,
  next: { level: (typeof SCORE_LEVELS)[number]; gap: number } | null,
): { title: string; body: string }[] {
  const out: { title: string; body: string }[] = [];
  const m = r.mistakes;
  const obj = r.competency.find((c) => c.key === "objective");
  const sub = r.competency.find((c) => c.key === "subjective");
  if (m.spellingTotal >= PRACTICE_MIN) {
    const why = obj && sub && obj.rate - sub.rate >= KIND_GAP ? "뜻은 알지만 쓰기에서 놓친 단어가 많습니다. " : "";
    out.push({ title: "철자 쓰기 연습", body: `${why}틀린 ${m.spellingTotal}단어를 소리 내어 읽으며 세 번씩 써 봅니다.` });
  }
  if (m.meaning >= PRACTICE_MIN) {
    out.push({ title: "뜻 구별 연습", body: `헷갈린 ${m.meaning}단어의 뜻을 예문과 함께 다시 봅니다.` });
  }
  if (r.weakWords.length > 0) {
    out.push({ title: "자주 틀리는 단어 복습", body: `평소 학습에서 자주 틀린 ${r.weakWords.length}단어를 먼저 복습합니다.` });
  }
  if (r.habits) {
    out.push(
      r.habits.activeDays >= STEADY_DAYS
        ? { title: "학습 리듬 유지", body: `최근 ${r.habits.days}일 중 ${r.habits.activeDays}일 학습했습니다. 지금 리듬을 이어 갑니다.` }
        : { title: "학습한 날 늘리기", body: `최근 ${r.habits.days}일 중 ${r.habits.activeDays}일 학습했습니다. 짧게라도 매일 학습해 봅니다.` },
    );
  }
  // 최대 4칸 — '다음 목표'는 늘 마지막 칸에 남긴다(연습 제안이 많아도 밀려나지 않게).
  const steps = out.slice(0, next ? 3 : 4);
  if (next) steps.push({ title: `다음 목표 Lv.${next.level.level}`, body: `${next.level.label} 단계까지 ${next.gap}점 남았습니다.` });
  return steps;
}
