/**
 * 설정 미리보기 — 저장된 원래 수치(`teacher_portfolio_months.raws`)에 고친 설정을 얹어 강사별 총점을 바로 다시 낸다.
 * 집계(`model/evaluate.ts`)와 같은 규칙: 켠 지표만, 수치가 없으면 '자료가 없을 때' 규칙, 빼기면 만점에서도 뺀다.
 */
import { isManualId, type EvaluationConfig, type MetricSetting } from "./config";
import { missingPoints, pointsFor } from "./scoring";

const round1 = (n: number) => Math.round(n * 10) / 10;

export type PreviewScore = { total: number; max: number; points: Record<string, number | null> };

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
    const p = raw === null || raw === undefined ? missingPoints(s) : pointsFor(raw, s.scoring, s.max);
    points[id] = p;
    if (p === null) continue;
    total += p;
    max += s.max;
  }
  return { total: round1(total), max: round1(max), points };
}
