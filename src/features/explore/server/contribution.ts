import "server-only";
import { getContributionGate } from "@/features/student-contribution/server/access";
import { getContributionStudent } from "@/features/student-contribution/server/student-query";
import { scoreRaws, sumRaws } from "@/features/student-contribution/model/calc";
import type { ExploreContribution } from "../model";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 기여도 기능이 이 사람·지점에 열려 있나 — 원생 상세 '기여도' 탭과 같은 열쇠(`getContributionGate`). 꺼졌으면 카드에 기여도 줄이 없다. */
export async function contributionEnabled(): Promise<boolean> {
  return !!(await getContributionGate());
}

/**
 * 왼쪽 열 '기여도·기록' 카드의 점수 — 원생 상세 '기여도' 탭과 **같은 조회·같은 계산**(`getContributionStudent` · 그 달 원수치+보정 →
 * `scoreRaws`). 달을 안 주면 마지막 집계 달. 무거운 조회라 첫 화면을 막지 않게 따로 늦게 채운다(page가 promise로 넘기고 카드가 기다린다).
 */
export async function loadExploreContribution(studentId: string, month?: string | null): Promise<ExploreContribution> {
  const want = month && MONTH.test(month) ? month : undefined;
  const base = `/students/${studentId}?tab=contribution`;
  try {
    const data = await getContributionStudent(studentId, want);
    if (!data) return { state: "error", month: want ?? null, months: [], href: base };
    if (!data.ready || data.months.length === 0) return { state: "empty", month: want ?? null, months: [], href: base };
    const selected = data.months.find((m) => m.month === want) ?? data.months[data.months.length - 1];
    const s = scoreRaws(sumRaws([selected.raws, selected.correction]), data.settings.config);
    return {
      state: "ready",
      month: selected.month,
      months: data.months.map((m) => m.month),
      total: s.total,
      operations: s.operations,
      participation: s.participation,
      href: `${base}&month=${selected.month}`,
    };
  } catch {
    return { state: "error", month: want ?? null, months: [], href: base };
  }
}
