import type { DutyItemView } from "../kinds";
import type { DutyKindCount, DutyWeekCell } from "../view";

export type DutyCount = { total: number; done: number; late: number };
export type DutyStripSummary = {
  overdue?: number; date: string; month: string; today: DutyCount; week: DutyCount; byKind: DutyKindCount[];
  counsel: DutyCount; exam: DutyCount; newcomer: DutyCount; newcomerShown?: boolean; lang: "ko" | "en";
};
export type DutyPayload = {
  date: string; days: string[]; items: DutyItemView[]; week: DutyWeekCell[]; month: DutyItemView[];
  newcomerShown?: boolean; classDays?: Record<string, string[]>; studentDays?: Record<string, string[]>;
};
export type LoadedDuties = { payload: DutyPayload; at: number };
