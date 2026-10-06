// 익스포터의 교시 축("2-1"·"2-2") ↔ 학원 교시표의 시각 · 사람이 읽는 글자. 순수.

import type { PeriodTime } from "@/features/timetable/lib/periods";
import { LEGACY_PERIOD_IDS } from "./grid-text";

export interface PeriodTables {
  /** 수학 평일 교시표(과목 전용 교시가 있으면 그것). 키 = "1".."N". */
  weekday: Record<string, PeriodTime>;
  weekend: Record<string, PeriodTime>;
}

const hm = (t: string) => (t ?? "").slice(0, 5);

/** 레거시 교시 id → 그 교시의 시작·종료 시각. 학원 교시표에 없으면 null. */
export function periodTimeOf(periodId: string, weekend: boolean, tables: PeriodTables): { startTime: string; endTime: string } | null {
  const table = weekend ? tables.weekend : tables.weekday;
  const ids = Object.keys(table).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const time = table[String(ids[LEGACY_PERIOD_IDS.indexOf(periodId)])];
  return time ? { startTime: hm(time.startTime), endTime: hm(time.endTime) } : null;
}

/** 교시 묶음을 글자로 — ["2-1","2-2"] → "2교시", ["3-2"] → "3교시 뒤 시간". 여러 교시에 걸치면 빈 문자열. */
export function periodLabel(periodIds: string[]): string {
  const idx = periodIds.map((p) => LEGACY_PERIOD_IDS.indexOf(p)).filter((i) => i >= 0).sort((a, b) => a - b);
  if (idx.length === 0) return "";
  const gid = Math.floor(idx[0]! / 2) + 1;
  if (idx.length === 2 && idx[0]! % 2 === 0 && idx[1] === idx[0]! + 1) return `${gid}교시`;
  return idx.length === 1 ? `${gid}교시 ${idx[0]! % 2 === 0 ? "앞" : "뒤"} 시간` : "";
}

/** "16:20~18:10 (2교시)". 학원 교시표에 그 교시가 없으면 시각 없이 "2교시"만 적는다. */
export function slotTimeText(slot: { periodIds: string[]; weekend: boolean }, tables: PeriodTables): string {
  const sorted = [...slot.periodIds].sort((a, b) => LEGACY_PERIOD_IDS.indexOf(a) - LEGACY_PERIOD_IDS.indexOf(b));
  if (sorted.length === 0 || sorted.some((p) => !LEGACY_PERIOD_IDS.includes(p))) return "교시를 읽지 못함";
  const label = periodLabel(sorted);
  const first = periodTimeOf(sorted[0]!, slot.weekend, tables);
  const last = periodTimeOf(sorted[sorted.length - 1]!, slot.weekend, tables);
  if (!first || !last) return label || `${sorted[0]!.split("-")[0]}교시부터 ${sorted.length}시간`;
  const range = `${first.startTime}~${last.endTime}`;
  return slot.weekend || !label ? range : `${range} (${label})`;
}
