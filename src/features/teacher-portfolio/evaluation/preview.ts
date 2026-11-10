/**
 * 설정 미리보기 — 저장된 원래 수치(`teacher_portfolio_months.raws`)에 고친 설정을 얹어 강사별 총점을 바로 다시 낸다.
 * 집계(`model/evaluate.ts`)와 같은 규칙: 켠 지표만, 수치가 없으면 '자료가 없을 때' 규칙, 빼기면 만점에서도 뺀다.
 * 규칙과 상관없이 뺀 칸(급여 비율의 새 선생님 — `newcomer`)은 저장할 때 표식(`excludedKey`)을 함께 싣는다.
 * 규칙과 상관없이 만점인 칸(프리랜서 근태 — `freelancer`, 원장 2026-10-16)도 표식(`fullKey`)을 싣는다.
 */
import { isManualId, type EvaluationConfig, type MetricSetting } from "./config";
import { missingPoints, pointsFor } from "./scoring";
import { round1 } from "@/lib/guards";


export type PreviewScore = { total: number; max: number; points: Record<string, number | null> };
/** 원래 수치 표에서 '설정 규칙과 상관없이 합계에서 뺐다'는 표식의 키(값 1) — 지표 id와 겹치지 않는다. */
export const excludedKey = (id: string) => `${id}#excluded`;
/** 원래 수치 표에서 '설정 규칙과 상관없이 만점'이라는 표식의 키(값 1). */
export const fullKey = (id: string) => `${id}#full`;

export function settingOf(config: EvaluationConfig, id: string): MetricSetting | undefined {
  if (isManualId(id)) return config.manual.find((m) => `manual:${m.key}` === id);
  return (config.metrics as Record<string, MetricSetting>)[id];
}

export function previewScore(raws: Readonly<Record<string, number | null | undefined>>, config: EvaluationConfig): PreviewScore {
  let total = 0;
  let max = 0;
  const points: Record<string, number | null> = {};
  for (const id of config.order) {
    const s = settingOf(config, id);
    if (!s || !s.enabled) continue;
    const raw = raws[id];
    const p = raws[fullKey(id)] ? s.max
      : raw === null || raw === undefined ? (raws[excludedKey(id)] ? null : missingPoints(s)) : pointsFor(raw, s.scoring, s.max);
    points[id] = p;
    if (p === null) continue;
    total += p;
    max += s.max;
  }
  return { total: round1(total), max: round1(max), points };
}
