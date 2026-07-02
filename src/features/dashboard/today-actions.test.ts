import { describe, expect, it } from "vitest";
import { buildTodayActions, nameList, type TodayActionsRaw } from "./today-actions";

const EMPTY: TodayActionsRaw = {
  absentToday: [],
  unrecordedYesterday: [],
  yesterday: "2026-07-01",
  failedAnalysis: { meetings: 0, enrollment: 0, consultations: 0 },
  makeeduIssue: null,
  pendingExpenses: 0,
  requestedTextbooks: 0,
  leavesPending: 0,
  leavesToday: [],
};

describe("buildTodayActions", () => {
  it("모든 신호 0이면 빈 배열(패널이 '정상' 표시)", () => {
    expect(buildTodayActions(EMPTY)).toEqual([]);
  });

  it("무단결석 = danger + 명단 요약 + /attendance 링크", () => {
    const items = buildTodayActions({
      ...EMPTY,
      absentToday: [
        { studentId: "1", name: "김민준" },
        { studentId: "2", name: "이서연" },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "absent",
      severity: "danger",
      count: 2,
      detail: "김민준·이서연",
      href: "/attendance",
    });
  });

  it("어제 미기록은 어제 날짜의 일별 페이지로 링크", () => {
    const items = buildTodayActions({
      ...EMPTY,
      unrecordedYesterday: [{ classId: "c1", className: "MS2A" }],
    });
    expect(items[0].href).toBe("/attendance/2026-07-01");
    expect(items[0].severity).toBe("amber");
  });

  it("분석 실패는 테이블별 분해 + 최다 실패 메뉴로 링크", () => {
    const items = buildTodayActions({
      ...EMPTY,
      failedAnalysis: { meetings: 1, enrollment: 3, consultations: 0 },
    });
    expect(items[0]).toMatchObject({
      key: "failed-analysis",
      severity: "danger",
      count: 4,
      detail: "회의 1 · 등록상담 3",
      href: "/enrollment",
    });
  });

  it("정렬: danger → amber → info, 같은 심각도는 건수 desc, 카운트 없는 신호는 뒤", () => {
    const items = buildTodayActions({
      ...EMPTY,
      absentToday: [{ studentId: "1", name: "a" }],
      pendingExpenses: 9,
      requestedTextbooks: 2,
      makeeduIssue: { kind: "stale", detail: "30시간째 미동기" },
      leavesToday: [{ name: "박지훈" }],
    });
    expect(items.map((i) => i.key)).toEqual([
      "absent", // danger
      "expenses", // amber 9
      "textbooks", // amber 2
      "makeedu", // amber count null → 뒤
      "leaves-today", // info
    ]);
  });

  it("makeedu 이상은 detail 그대로 + owner 연동 면 링크", () => {
    const items = buildTodayActions({
      ...EMPTY,
      makeeduIssue: { kind: "error", detail: "students 실패" },
    });
    expect(items[0]).toMatchObject({ count: null, detail: "students 실패", href: "/owner?tab=sheets" });
  });

  it("휴가: 승인 대기=amber, 오늘 휴가=info(명단)", () => {
    const items = buildTodayActions({
      ...EMPTY,
      leavesPending: 1,
      leavesToday: [{ name: "김은정" }, { name: "박서연" }],
    });
    expect(items.map((i) => i.key)).toEqual(["leaves-pending", "leaves-today"]);
    expect(items[1].detail).toBe("김은정·박서연");
  });
});

describe("nameList", () => {
  it("max 초과분은 '외 N'으로 요약", () => {
    expect(nameList(["a", "b", "c", "d", "e"])).toBe("a·b·c 외 2");
    expect(nameList(["a", "b"])).toBe("a·b");
    expect(nameList(["a", "b", "c"], 2)).toBe("a·b 외 1");
  });
});
