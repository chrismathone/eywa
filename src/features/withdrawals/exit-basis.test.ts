import { describe, expect, it } from "vitest";
import { EXIT_REPORT_RULE, countedEarlier, countedEarlierByMonth, countedEarlierTitle, countedMonthLabel, exitBasisRule } from "./exit-basis";

// 원장 2026-11-03 *"오해 소지가 없도록 문구들 수정"* — 퇴원·수강종료를 어느 달로 세는지 화면 말 한 벌.
describe("exit-basis — 세는 달 문구", () => {
  it("규칙 문장 = 날짜는 마지막 수업일 · 달은 수업료 납부(퇴원은 전체 · 수강종료는 그 과목 · 낸 기록 없으면 마지막 수업일의 달) · 달을 주면 그 달로 예를 든다(1월은 지난해 12월)", () => {
    expect(exitBasisRule()).toBe("퇴원·수강종료 날짜는 마지막 수업일이고, 어느 달로 셀지는 수업료 납부로 정합니다 — 퇴원은 수업료를 낸 마지막 달, 수강종료는 그 과목 수업료를 낸 마지막 달(낸 기록이 없으면 마지막 수업일의 달).");
    expect(exitBasisRule("2026-11")).toContain("예: 마지막 수업일이 11월 1일이어도 10월분까지만 냈으면 10월로 셉니다.");
    expect(exitBasisRule("2027-01")).toContain("예: 마지막 수업일이 1월 1일이어도 12월분까지만 냈으면 12월로 셉니다.");
    expect(EXIT_REPORT_RULE).toBe("매달 1~10일에는 지난달, 11일부터 다음 달 10일까지는 이번 달 퇴원·수업종료를 보여 줍니다.");
    expect(exitBasisRule("bad")).toBe(exitBasisRule());
  });

  it("앞 달로 센 줄 = 창 안에 처리 + 센 날이 창보다 앞(창 안·창 뒤 처리, 같은 달로 센 줄은 아니다)", () => {
    const from = "2026-11-01", to = "2026-11-03";
    expect(countedEarlier({ date: "2026-11-01", countDate: "2026-10-31" }, from, to)).toBe(true);
    expect(countedEarlier({ date: "2026-11-03", countDate: "2026-06-30" }, from, to)).toBe(true);
    expect(countedEarlier({ date: "2026-11-01", countDate: "2026-11-01" }, from, to)).toBe(false);
    // 오늘 뒤에 적힌 퇴원 예정은 아직 처리 전이다.
    expect(countedEarlier({ date: "2026-11-10", countDate: "2026-10-31" }, from, to)).toBe(false);
    expect(countedEarlier({ date: "2026-10-30", countDate: "2026-10-30" }, from, to)).toBe(false);
    expect(countedEarlier({ date: null, countDate: "2026-10-31" }, from, to)).toBe(false);
    expect(countedEarlier({ date: "2026-11-01", countDate: null }, from, to)).toBe(false);
  });

  it("묶음 제목·줄 꼬리표", () => {
    expect(countedEarlierTitle("2026-11", 4, "명")).toBe("마지막 수업일이 11월이지만 앞 달로 센 4명");
    expect(countedEarlierTitle("2026-11", 4, "건")).toBe("마지막 수업일이 11월이지만 앞 달로 센 4건");
    expect(countedMonthLabel("2026-10")).toBe("10월로 셈");
  });

  it("퇴원관리 묶음 — 앞 달로 센 줄만 센 달마다(최근 달 먼저), 같은 달로 센 줄·오늘 뒤 예정은 빼고", () => {
    const rows = [
      { date: "2026-11-01", countDate: "2026-10-31" },
      { date: "2026-11-01", countDate: "2026-10-31" },
      { date: "2026-11-02", countDate: "2026-04-30" },
      { date: "2026-11-02", countDate: "2026-11-02" },
      { date: "2026-11-20", countDate: "2026-10-31" },
    ];
    expect(countedEarlierByMonth(rows, "2026-11-01", "2026-11-03")).toEqual([["2026-10", 2], ["2026-04", 1]]);
    expect(countedEarlierByMonth([], "2026-11-01", "2026-11-03")).toEqual([]);
  });
});
