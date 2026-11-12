import type { OpsDaily } from "../ops-daily";

/**
 * 부분 계산 실패 때 앞서 기록한 운영 지표를 보존하되, 현재 꺼진 기능에 의존하는 값만 비운다.
 * 상담 진행 자체는 캘린더 없이 계산되므로 입테 건수만 캘린더 판정을 따른다.
 */
export function filterKeptOps(
  kept: OpsDaily,
  modules: { calendar: boolean; newcomers: boolean },
): OpsDaily {
  const filtered: OpsDaily = {
    ...kept,
    ...(kept.consult
      ? { consult: { ...kept.consult, counts: { ...kept.consult.counts } } }
      : {}),
  };
  if (!modules.calendar && filtered.consult) filtered.consult.counts.levelTest = null;
  if (!modules.newcomers) delete filtered.newcomers;
  return filtered;
}
