import "server-only";
import { addDays, kstToday } from "@/lib/date-kst";
import { countDuties, foldCounts, listOwnerMonthDuties } from "./queries";
import { buildMonthRows, foldRows } from "../view-month";

export type DutyCountTriple = { total: number; done: number; late: number };
export type DutySummary = {
  date: string; month: string; today: DutyCountTriple; week: DutyCountTriple;
  byKind: { kind: string; total: number; done: number; late: number }[]; counsel: DutyCountTriple; newcomer: DutyCountTriple;
};

/** 한 사람의 '내 업무' 숫자(오늘 · 이번 주 · 이번 달) — 강사 홈 첫 그리기와 60초 갱신(GET)이 같은 함수. 세 조회는 독립(B4). */
export async function loadDutySummary(tenantId: string, ownerId: string): Promise<DutySummary> {
  const date = kstToday();
  const month = date.slice(0, 7);
  const [todayRows, weekRows, monthItems] = await Promise.all([
    countDuties(tenantId, ownerId, date, date),
    countDuties(tenantId, ownerId, addDays(date, -6), date),
    listOwnerMonthDuties(tenantId, ownerId, month),
  ]);
  const todayDaily = todayRows.filter((c) => c.period === "daily");
  const { counsel, newcomer } = buildMonthRows(monthItems, Date.now());
  return { date, month, today: foldCounts(todayDaily), week: foldCounts(weekRows.filter((c) => c.period === "daily")),
    byKind: todayDaily.map((c) => ({ kind: c.kind, total: c.total, done: c.done, late: c.late })), counsel: foldRows(counsel), newcomer: foldRows(newcomer) };
}
