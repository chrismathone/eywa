/**
 * 마감한 달에 '강사 탓이 아닌 사유' 규칙을 얹는다 — 원장 2026-10-14 *"새 규칙 적용"*(순수 · Vitest).
 *
 * 마감한 달은 굳는다(0357a — 마감 뒤 보충한 기록으로 점수가 바뀌지 않게). 이 규칙만은 원장이 마감한 달에도 쓰라고 정했다:
 * 저장된 학생 배정·유지 줄은 그대로 두고, 지금 계산이 사유로 감점하지 않는 퇴원·수강종료(`noteOf`가 까닭을 돌려주는 줄)만
 * −1 → 0으로 바꾼 뒤, **그 달을 매긴 설정**(`period.evaluation`)으로 그 항목 점수와 합계를 다시 낸다. 다른 항목은 손대지 않는다.
 * 합계 식은 `applyEvaluation`과 같다(켠 항목 중 점수가 있는 것의 합 · 만점 합).
 */
import { settingOf } from "../evaluation/preview";
import { pointsFor } from "../evaluation/scoring";
import { round1 } from "./dates";
import { STUDENTS_REASON } from "./metrics";
import { STUDENT_BASE_POINTS } from "./students";
import type { PortfolioPeriod, StudentEvent, StudentsMetric } from "./types";

const clampScore = (n: number) => Math.min(20, Math.max(0, n));

/** 바꾼 줄 수 — 0이면 손대지 않았다. 설정이 없는 옛 행(점수 식을 모름)은 고치지 않는다. */
export function excuseStoredExits(period: PortfolioPeriod, noteOf: (e: StudentEvent) => string | null): number {
  const item = period.items.find((m): m is StudentsMetric => m.id === "students");
  const t = item?.tracking;
  const setting = period.evaluation ? settingOf(period.evaluation, "students") : undefined;
  if (!item || !t || !setting) return 0;
  let changed = 0;
  const detail = t.detail.map((e) => {
    if ((e.type !== "퇴원" && e.type !== "수강종료") || e.points >= 0 || e.note) return e;
    const note = noteOf(e);
    if (!note) return e;
    changed++;
    return { ...e, points: 0, note };
  });
  if (!changed) return 0;
  const scored = (type: StudentEvent["type"]) => detail.filter((e) => e.type === type && e.points !== 0).length;
  t.detail = detail;
  t.adjustment = detail.reduce((n, e) => n + e.points, 0);
  t.value = clampScore(STUDENT_BASE_POINTS + t.adjustment);
  t.change = t.value - t.previousPoints;
  t.exitCount = scored("퇴원");
  t.endedCount = scored("수강종료");
  t.unscored = detail.filter((e) => e.points === 0).length;
  t.excused = detail.filter((e) => e.note).length;
  item.detail = detail;
  item.reason = STUDENTS_REASON; // 설명도 지금 규칙으로(숫자만 바꾸면 '퇴원·수강종료 −1' 옆에 0인 줄이 선다).
  item.raw = t.adjustment;
  item.value = pointsFor(t.adjustment, setting.scoring, setting.max);
  const counted = period.items.filter((m) => !m.off && m.value !== null);
  period.knownCount = counted.length;
  period.knownScore = round1(counted.reduce((n, m) => n + (m.value as number), 0));
  period.knownMax = round1(counted.reduce((n, m) => n + m.max, 0));
  period.total = period.knownScore;
  return changed;
}
