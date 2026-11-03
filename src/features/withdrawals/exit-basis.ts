/**
 * 퇴원·수강종료를 **어느 달로 세는지** 화면에 적는 말 한 벌 — 운영실(KPI·팝업·추이), 퇴원관리, 원생 통계, 도움말이 같이 쓴다.
 *
 * 원장 2026-11-03 *"오해 소지가 없도록 문구들 수정해야겠는데"* — 퇴원일이 11월 1일인 퇴원·수강종료 4건이 모두 10월분까지만 수업료를
 * 내 10월로 세졌는데, 운영실 카드가 '이번 달(11월 1일~오늘) 0명'이라 적어 오류처럼 보였다.
 * 규칙은 `exit-month.ts`(원장 2026-10-29)다 — 퇴원 = 수업료 전체(`exitMonthOf`), 수강종료 = 그 과목 수업료(`subjectExitCountDate`),
 * 낸 기록이 없으면 퇴원일·종료일의 달. 이 파일은 그 규칙을 **말로 옮길 뿐** 판정을 바꾸지 않는다.
 * 클라이언트 화면도 불러 쓰므로 서버 전용·무거운 모듈을 들이지 않는다.
 */

import { EXIT_REPORT_SWITCH_DAY } from "./window";

/** 짧은 꼬리표 — 카드 머리·추이 설명 칸. */
export const EXIT_BASIS_TAG = "수업료 낸 달 기준";

const monthNo = (ym: string) => Number(ym.slice(5, 7));
const previousMonth = (ym: string) => {
  const y = Number(ym.slice(0, 4));
  const m = monthNo(ym);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

/**
 * 규칙 한 문장 — 팝업·퇴원관리·도움말. `month`(YYYY-MM)를 주면 그 달로 예를 든다(11월 → "11월 1일 퇴원이어도 10월분까지만 냈으면 10월").
 */
export function exitBasisRule(month?: string): string {
  // 원장 2026-11-03 *"마지막 수업일 기준이라는 멘트와 수강료 납부 관련 멘트도 적어줄것"* — 날짜는 마지막 수업일, 달은 수업료 납부로.
  const rule =
    "퇴원·수강종료 날짜는 마지막 수업일이고, 어느 달로 셀지는 수업료 납부로 정합니다 — 퇴원은 수업료를 낸 마지막 달, 수강종료는 그 과목 수업료를 낸 마지막 달(낸 기록이 없으면 마지막 수업일의 달).";
  if (!month || !/^\d{4}-\d{2}$/.test(month)) return rule;
  const prev = monthNo(previousMonth(month));
  return `${rule} 예: 마지막 수업일이 ${monthNo(month)}월 1일이어도 ${prev}월분까지만 냈으면 ${prev}월로 셉니다.`;
}

/** 운영실 카드가 어느 달을 보여 주는지(`exitReportMonth` · 원장 2026-11-03) — 팝업 아래·도움말. */
export const EXIT_REPORT_RULE = `매달 1~${EXIT_REPORT_SWITCH_DAY}일에는 지난달, ${EXIT_REPORT_SWITCH_DAY + 1}일부터 다음 달 ${EXIT_REPORT_SWITCH_DAY}일까지는 이번 달 퇴원·수업종료를 보여 줍니다.`;

/**
 * 창 [from, to] 안에 **퇴원·종료**했지만(퇴원일·종료일) 수업료를 앞 달까지만 내 **창보다 앞 달로 센** 줄인가 — 숫자에는 들지 않고 '앞 달로 센'으로 따로 밝힌다.
 * `date` = 퇴원일·종료일, `countDate` = 센 날(`exitCountDate` — 앞 달이면 그 달 말일). 오늘 뒤에 적힌 퇴원 예정은 `to`(오늘)에서 걸린다.
 */
export function countedEarlier(row: { date: string | null; countDate: string | null }, from: string, to: string): boolean {
  if (!row.date || !row.countDate) return false;
  const day = row.date.slice(0, 10);
  return day >= from && day <= to && row.countDate.slice(0, 10) < from;
}

/** 앞 달로 센 줄을 센 달마다 묶는다(최근 달 먼저) — 퇴원관리 '이번 달' 안내가 그 달 명단으로 보낸다. */
export function countedEarlierByMonth(
  rows: readonly { date: string | null; countDate: string | null }[],
  from: string,
  to: string,
): [month: string, count: number][] {
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    if (!countedEarlier(r, from, to)) continue;
    const m = r.countDate!.slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
  }
  return [...byMonth].sort((a, b) => b[0].localeCompare(a[0]));
}

/** '앞 달로 센' 묶음 제목 — 운영실 팝업·퇴원관리가 같은 말(단위는 그 화면 숫자의 단위). `month` = 퇴원·종료한 달(YYYY-MM). */
export function countedEarlierTitle(month: string, count: number, unit: "명" | "건"): string {
  return `마지막 수업일이 ${monthNo(month)}월이지만 앞 달로 센 ${count}${unit}`;
}

/** 줄 끝 꼬리표 — "10월로 셈". */
export function countedMonthLabel(countMonth: string): string {
  return `${monthNo(countMonth)}월로 셈`;
}
