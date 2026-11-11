/**
 * 한 달의 항목에 강사평가 설정을 얹는다 — 원래 수치(`raw`) → 점수 · 만점 · 이름 · 차례 · 합계.
 * 계산 코드는 수치만 내고, 몇 점인지는 여기서 설정이 정한다(원장 2026-10-13 *"가능한 모든것을 커스터마이징"*).
 *
 * - 자료가 없으면(`raw` null) 지표의 '자료가 없을 때' 규칙: 0점(기본) · 만점 · 합계에서 제외.
 *   예외 = 급여 비율의 새로 온 선생님(지난달 담당 반 없음 · `newcomer`)은 규칙과 상관없이 합계에서 제외(원장 2026-10-15).
 * - 끈 지표는 저장은 하되(설정 미리보기가 그 수치를 쓴다) 화면·합계엔 없다.
 * - 총점 = 합계에 든 점수의 합, 만점 = 그 지표들 만점의 합 — 100점이 아니어도 된다.
 */
import { isManualId, type EvaluationConfig, type MetricSetting } from "../evaluation/config";
import { missingPoints, pointsFor } from "../evaluation/scoring";
import { round1 } from "./dates";
import type { ManualMetricItem, Metric, PortfolioPeriod } from "./types";

/** 원장이 그 강사·그 달에 넣은 직접 만든 지표 값. */
export type ManualEntry = { value: number | null; note: string | null };
/** 입력 한 줄(`teacher_evaluation_entries`, 0359a). */
export type ManualEntryRow = { teacher_id: string; month: string; metric_key: string; value: number | string | null; note: string | null };

/** 입력 줄 → (강사, 달) → 지표 키 → 값. */
export function indexEntries(rows: readonly ManualEntryRow[]): (teacherId: string, month: string) => ReadonlyMap<string, ManualEntry> {
  const index = new Map<string, Map<string, ManualEntry>>();
  for (const e of rows) {
    const key = `${e.teacher_id}|${e.month}`;
    if (!index.has(key)) index.set(key, new Map());
    const value = e.value === null || e.value === "" ? null : Number(e.value);
    index.get(key)!.set(e.metric_key, { value: value !== null && Number.isFinite(value) ? value : null, note: e.note });
  }
  const empty = new Map<string, ManualEntry>();
  return (teacherId, month) => index.get(`${teacherId}|${month}`) ?? empty;
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 한 항목에 설정 하나를 얹는다(점수·만점·이름·끔) — 마감 달 정정(`revision.ts`)도 그 달 저장 설정으로 이 함수를 부른다. */
export function scoreItem<M extends Metric>(m: M, s: MetricSetting): M {
  m.label = s.label;
  m.max = s.max;
  m.off = !s.enabled || undefined;
  const raw = m.raw ?? null;
  // 프리랜서 근태 = 만점(원장 2026-10-16) — 설정의 점수 규칙과 상관없이(만점을 바꾸면 바꾼 만점).
  if ((m as { freelancer?: boolean }).freelancer) {
    delete m.missing;
    delete m.gap;
    m.value = s.max;
    return m;
  }
  if (raw === null) {
    m.missing = true;
    m.value = (m as { newcomer?: boolean }).newcomer ? null : missingPoints(s);
    m.gap = m.gap ?? "자료 없음";
  } else {
    delete m.missing;
    delete m.gap; // 수치가 있으면 '근거 확인' 꼬리표는 낡은 것이다(계산 코드가 값 null로 넘긴 지표).
    m.value = pointsFor(raw, s.scoring, s.max);
  }
  return m;
}

export function applyEvaluation(p: PortfolioPeriod, config: EvaluationConfig, entries: ReadonlyMap<string, ManualEntry> = new Map()): void {
  const items: Metric[] = [];
  for (const id of config.order) {
    if (isManualId(id)) {
      const s = config.manual.find((m) => `manual:${m.key}` === id);
      if (!s) continue;
      const entry = entries.get(s.key);
      const raw = entry?.value ?? null;
      const item: ManualMetricItem = {
        id: `manual:${s.key}`, max: s.max, value: null, raw, unit: s.unit, detail: [],
        basis: raw === null ? "이 달 입력 없음" : `${fmt(raw)}${s.unit}`,
        reason: s.description || "원장이 달마다 입력하는 지표입니다.",
        ...(entry?.note ? { note: entry.note } : {}),
      };
      items.push(scoreItem(item, s));
      continue;
    }
    const m = p.items.find((x) => x.id === id);
    if (m && !isManualId(m.id)) items.push(scoreItem(m, config.metrics[m.id as keyof EvaluationConfig["metrics"]]));
  }
  p.items = items;
  const counted = items.filter((m) => !m.off && m.value !== null);
  const score = round1(counted.reduce((n, m) => n + (m.value as number), 0));
  p.knownCount = counted.length;
  p.knownScore = score;
  p.knownMax = round1(counted.reduce((n, m) => n + m.max, 0));
  p.total = score;
  p.evaluation = config;
}
