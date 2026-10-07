/**
 * 영역별 채점 — **정답률**과 **도달 수준**(어느 학년 수준 문항까지 안정적으로 맞히나).
 * 원장 2026-10-07 *"영역별 정답률이 달라져야 함 · 단어 수준 기록 - 몇학년 수준인지"*.
 *
 * 🔑 도달 수준 규칙(설명 가능해야 학부모에게 말할 수 있다):
 *   문항마다 난이도 수준(L1~L9)이 붙어 있다. 낮은 수준부터 올라가며 그 수준 문항을 **기준 정답률 이상** 맞히면 통과,
 *   처음으로 못 넘는 수준에서 멈춘다. 그 수준 문항이 아예 없으면 건너뛴다(판정 재료가 없을 뿐 실패가 아니다).
 *   하나도 못 넘으면 가장 낮은 출제 수준 아래로 보지 않고 **L1**로 둔다.
 * ⚠️ 문항 수가 너무 적은 수준(1문항)은 우연이 크다 — `MIN_ITEMS_PER_LEVEL` 미만이면 그 수준은 판정에서 건너뛴다.
 */
import { isLevel, type Level } from "./levels";

export type AreaKey = "vocab" | "grammar" | "listening" | "reading";

export const AREA_LABEL: Record<AreaKey, string> = {
  vocab: "어휘",
  grammar: "문법",
  listening: "듣기",
  reading: "독해",
};
export const AREA_ORDER: readonly AreaKey[] = ["vocab", "grammar", "listening", "reading"];

/** 한 문항 — 정오 + 난이도 수준 + (틀렸을 때 묶을) 유형 태그. */
export type ItemResult = {
  correct: boolean;
  level: Level;
  /** 오답 분석 묶음 이름(예: "현재완료", "불규칙 동사 과거형", "주제 찾기"). 없으면 영역 이름으로 묶인다. */
  tag?: string;
};

export const PASS_RATE = 0.6;
export const MIN_ITEMS_PER_LEVEL = 2;

export type AreaResult = {
  area: AreaKey;
  correct: number;
  total: number;
  /** 0~1. 문항이 없으면 null. */
  rate: number | null;
  /** 도달 수준. 문항이 없으면 null. */
  level: Level | null;
  /** 다음 수준 문항 정답률(0~1) — "다음 단계까지 얼마나 왔나". 다음 수준 문항이 없으면 null. */
  nextLevelRate: number | null;
};

export function scoreArea(area: AreaKey, items: readonly ItemResult[]): AreaResult {
  const valid = items.filter((i) => isLevel(i.level));
  const correct = valid.filter((i) => i.correct).length;
  const total = valid.length;
  if (total === 0) return { area, correct: 0, total: 0, rate: null, level: null, nextLevelRate: null };

  const byLevel = new Map<Level, { c: number; n: number }>();
  for (const i of valid) {
    const b = byLevel.get(i.level) ?? { c: 0, n: 0 };
    b.n += 1;
    if (i.correct) b.c += 1;
    byLevel.set(i.level, b);
  }
  let reached: Level = 1;
  let nextLevelRate: number | null = null;
  for (let n = 1; n <= 9; n++) {
    const b = byLevel.get(n as Level);
    if (!b || b.n < MIN_ITEMS_PER_LEVEL) continue; // 판정 재료가 없을 뿐 실패가 아니다
    if (b.c / b.n >= PASS_RATE) {
      reached = n as Level;
      continue;
    }
    nextLevelRate = b.c / b.n;
    break;
  }
  return { area, correct, total, rate: correct / total, level: reached, nextLevelRate };
}

/** 오답 분석 — 틀린 문항을 유형별로 묶어 많은 순(동률은 이름순). */
export function wrongAnswerGroups(
  items: readonly (ItemResult & { area: AreaKey })[],
): { tag: string; area: AreaKey; wrong: number; total: number }[] {
  const map = new Map<string, { tag: string; area: AreaKey; wrong: number; total: number }>();
  for (const i of items) {
    const tag = i.tag?.trim() || AREA_LABEL[i.area];
    const key = `${i.area}|${tag}`;
    const g = map.get(key) ?? { tag, area: i.area, wrong: 0, total: 0 };
    g.total += 1;
    if (!i.correct) g.wrong += 1;
    map.set(key, g);
  }
  return [...map.values()]
    .filter((g) => g.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || a.tag.localeCompare(b.tag, "ko"));
}
