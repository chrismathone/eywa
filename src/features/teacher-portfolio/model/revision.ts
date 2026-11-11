/**
 * 마감한 달의 **담임 판정 정정** 계획(원장 2026-11-11 *"추천방식으로 시작"* — 순수 · Vitest).
 *
 * 담임 이력이 감사로그만 봐서 빠진 교체를 지금 담임으로 과거에 붙이던 것을 고쳤다(`homeroom-history.ts`). 마감한 달은 DB가
 * 고치지 못하게 막으므로(0357a) 정정은 따로 한다 — 같은 스냅숏으로 **옛 판정(before)·새 판정(after)**을 계산해 둘이 다른 자리만
 * 새 판정 값으로 바꾸고, 판정과 상관없는 자리는 **저장값 그대로** 둔다(마감 뒤 보충한 기록이 점수를 바꾸지 않게 — 0357a 원칙).
 *
 * - 항목: id마다 before ≠ after면 after를 **그 달 저장 설정(`payload.evaluation`)으로** 다시 매긴 것 · 같으면 저장 항목 그대로.
 *   직접 만든 지표(`manual:*`)는 판정과 무관해 늘 그대로.
 * - 위 칸(과목·반·학생 수·본인 기록 수·휴일·날별 통계): before ≠ after면 after · 같으면 저장값.
 * - 합계: 고친 항목으로 다시(`applyEvaluation` 꼬리와 같은 식).
 * - before·after 어느 하나라도 없으면 손대지 않고 알린다(새 판정을 못 보면 활동 여부도 모른다 — 지우지도 않는다).
 * - 그 달 전체가 재직 밖(입사 전 · 퇴사 뒤)이면 줄을 지운다 — 단 새 판정에도 그 사람의 활동(반·학생·본인 보고서)이 남으면
 *   입사일이 틀렸을 수 있어 지우지 않고 알린다(반대 증거가 있으면 손대지 않는다).
 */
import { isManualId, type EvaluationConfig } from "../evaluation/config";
import { round1 } from "./dates";
import { scoreItem } from "./evaluate";
import type { Metric, PortfolioPeriod } from "./types";

export type StoredMonth = { teacherId: string; month: string; payload: PortfolioPeriod };
export type RevisionTenure = { hireDate: string | null; resignDate: string | null };
export type RevisionAction =
  | { kind: "same"; teacherId: string; month: string }
  | { kind: "revise"; teacherId: string; month: string; payload: PortfolioPeriod; changed: string[] }
  | { kind: "remove"; teacherId: string; month: string; reason: "beforeHire" | "afterResign" }
  | { kind: "skip"; teacherId: string; month: string; reason: "noBefore" | "noAfter" | "activityOutsideTenure" };

/** 판정에 따라 바뀔 수 있는 위 칸 — 달·날짜·설정 사본은 건드리지 않는다. */
export const REVISABLE_FIELDS = ["subjects", "classes", "students", "ownReportRecords", "holidays", "dayStats"] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const clone = <T>(v: T): T => structuredClone(v);

/** 그 달 전체가 재직 밖인가 — 입사일이 말일 뒤 · 퇴사일이 1일 앞(입사일보다 앞선 퇴사일은 옛 재직의 것이라 보지 않는다). */
export function outsideTenure(window: { start: string; end: string }, t: RevisionTenure | undefined): "beforeHire" | "afterResign" | null {
  if (!t) return null;
  const hire = t.hireDate?.slice(0, 10) ?? null, resign = t.resignDate?.slice(0, 10) ?? null;
  if (hire && hire > window.end) return "beforeHire";
  if (resign && !(hire && resign < hire) && resign < window.start) return "afterResign";
  return null;
}

/** 합계를 항목으로 다시 — `applyEvaluation`과 같은 식(끈 지표·값 없는 지표는 합계에 안 든다). */
export function retotal(p: PortfolioPeriod): void {
  const counted = p.items.filter((m) => !m.off && m.value !== null);
  p.knownCount = counted.length;
  p.knownScore = round1(counted.reduce((n, m) => n + (m.value as number), 0));
  p.knownMax = round1(counted.reduce((n, m) => n + m.max, 0));
  p.total = p.knownScore;
}

function hasActivity(p: PortfolioPeriod): boolean {
  return p.students > 0 || p.classes.length > 0 || p.ownReportRecords > 0;
}

export function planRevision(input: {
  stored: readonly StoredMonth[];
  before: (teacherId: string, month: string) => PortfolioPeriod | undefined;
  after: (teacherId: string, month: string) => PortfolioPeriod | undefined;
  tenure: (teacherId: string) => RevisionTenure | undefined;
  /** 저장 행에 설정 사본이 없을 때 쓸 설정(옛 저장 행) — 지금 침산 행은 모두 사본이 있다. */
  fallbackConfig: EvaluationConfig;
}): RevisionAction[] {
  return input.stored.map((row): RevisionAction => {
    const { teacherId, month, payload } = row;
    const before = input.before(teacherId, month);
    const after = input.after(teacherId, month);
    if (!before) return { kind: "skip", teacherId, month, reason: "noBefore" };
    if (!after) return { kind: "skip", teacherId, month, reason: "noAfter" };
    const outside = outsideTenure(payload, input.tenure(teacherId));
    if (outside) {
      if (hasActivity(after)) return { kind: "skip", teacherId, month, reason: "activityOutsideTenure" };
      return { kind: "remove", teacherId, month, reason: outside };
    }

    const config = payload.evaluation ?? input.fallbackConfig;
    const next = clone(payload);
    const changed: string[] = [];
    next.items = payload.items.map((stored): Metric => {
      if (isManualId(stored.id)) return stored;
      const b = before.items.find((m) => m.id === stored.id);
      const a = after.items.find((m) => m.id === stored.id);
      if (!a || !b || same(a, b)) return stored;
      const setting = config.metrics[stored.id as keyof EvaluationConfig["metrics"]];
      if (!setting) return stored;
      changed.push(stored.id);
      return scoreItem(clone(a), setting);
    });
    for (const f of REVISABLE_FIELDS) {
      if (same(before[f], after[f])) continue;
      (next as Record<string, unknown>)[f] = clone(after[f]);
      changed.push(f);
    }
    if (!changed.length) return { kind: "same", teacherId, month };
    retotal(next);
    return { kind: "revise", teacherId, month, payload: next, changed };
  });
}
