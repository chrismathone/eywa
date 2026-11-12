import "server-only";
import { kstToday } from "@/lib/date-kst";
import { weekDaysOf } from "../view";
import { countDuties, countOwnerLate, dutyLiveFrom, foldCounts, listOwnerMonthDuties } from "./queries";
import { buildMonthRows, foldRows } from "../view-month";

export type DutyCountTriple = { total: number; done: number; late: number };
export type DutySummary = {
  date: string; month: string; today: DutyCountTriple; week: DutyCountTriple;
  byKind: { kind: string; total: number; done: number; late: number }[]; counsel: DutyCountTriple; exam: DutyCountTriple; newcomer: DutyCountTriple;
  /** 지금 지연(열린 채 기한이 지난 것 전부 · 기간 무관 · 이관 제외) — 관리자 화면 '기한 초과'과 같은 수. */
  overdue: number;

};

/** 한 사람의 '내 업무' 숫자(오늘 · 이번 주 · 이번 달) — 강사 홈 첫 그리기와 60초 갱신(GET)이 같은 함수. 세 조회는 독립(B4). */
export async function loadDutySummary(tenantId: string, ownerId: string): Promise<DutySummary> {
  const date = kstToday();
  const month = date.slice(0, 7);
  const liveFrom = await dutyLiveFrom(tenantId);
  const [todayRows, weekRows, monthItems, overdue] = await Promise.all([
    countDuties(tenantId, ownerId, date, date),
    // 이번 주 = 월요일부터 오늘까지(주는 항상 월요일 시작).
    countDuties(tenantId, ownerId, weekDaysOf(date)[0]!, date),
    listOwnerMonthDuties(tenantId, ownerId, month, liveFrom),
    countOwnerLate(tenantId, ownerId, liveFrom),
  ]);
  const todayDaily = todayRows.filter((c) => c.period === "daily");
  const { counsel, exam, newcomer } = buildMonthRows(monthItems, Date.now());
  return { date, month, today: foldCounts(todayDaily), week: foldCounts(weekRows.filter((c) => c.period === "daily")),
    byKind: todayDaily.map((c) => ({ kind: c.kind, total: c.total, done: c.done, late: c.late })), counsel: foldRows(counsel), exam: foldRows(exam), newcomer: foldRows(newcomer), overdue };
}
