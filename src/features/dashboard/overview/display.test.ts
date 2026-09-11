import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/features/calendar/types";
import {
  dashboardDate,
  staffDisplayRole,
  upcomingAdmissionsEvents,
} from "./display";

const event = (
  title: string,
  extra: Partial<CalendarEvent> = {},
): CalendarEvent => ({
  id: title,
  title,
  memo: null,
  startDate: "2026-09-11",
  endDate: "2026-09-11",
  startTime: "15:00",
  endTime: null,
  color: "blue",
  source: "manual",
  tag: null,
  seriesId: null,
  createdByName: null,
  ...extra,
});

describe("대시보드 표시 기준", () => {
  it("레벨테스트의 실제 약칭과 첫 수업만 포함하고 취소·차단·운영 일정은 제외한다", () => {
    const included = [
      "영수입테",
      "영어 레테",
      "레벨 테스트",
      "첫 수업",
      "수학 첫수업",
    ];
    const excluded = [
      "Daily Open Briefing",
      "학부모 설명회",
      "입학 상담",
      "[취소] 레테",
      "레테 취소",
      "입테 예약 금지",
      "첫 수업 예약차단",
    ];
    const rows = [
      ...included.map((title) => event(title)),
      ...excluded.map((title) => event(title)),
      event("안내문", { memo: "첫 수업 절차" }),
      event("레테", { source: "leave" }),
      event("레테", {
        tag: { id: "tag", name: "01. 운영팀 중요일정", color: "blue" },
      }),
      event("이전 레테", { startDate: "2026-09-10", endDate: "2026-09-10" }),
      event("다음 레테", { startDate: "2026-09-18", endDate: "2026-09-18" }),
    ];
    expect(
      upcomingAdmissionsEvents(rows, "2026-09-11", "2026-09-17")
        .map((e) => e.title)
        .sort(),
    ).toEqual(included.sort());
  });
  it("월을 넘기는 기간에도 날짜·시간 순서로 표시한다", () => {
    const rows = [
      event("첫수업 오후", {
        startDate: "2026-10-01",
        endDate: "2026-10-01",
        startTime: "17:00",
      }),
      event("첫수업 오전", {
        startDate: "2026-10-01",
        endDate: "2026-10-01",
        startTime: "09:00",
      }),
    ];
    expect(
      upcomingAdmissionsEvents(rows, "2026-09-29", "2026-10-05").map(
        (e) => e.title,
      ),
    ).toEqual(["첫수업 오전", "첫수업 오후"]);
  });
  it("박소선의 표시 분류만 관리자이며 다른 원장·권한 값은 유지한다", () => {
    const user = {
      id: "fcf735fa-edf7-4095-8fa6-724285a018ed",
      system_role: "master",
    };
    expect(staffDisplayRole(user)).toBe("admin");
    expect(user.system_role).toBe("master");
    expect(staffDisplayRole({ id: "other", system_role: "master" })).toBe(
      "master",
    );
  });
  it("날짜에 두 자리 연도와 정확한 요일을 표시한다", () => {
    expect(dashboardDate("2026-09-10")).toBe("26.09.10 (목)");
    expect(dashboardDate("2026-09-11")).toBe("26.09.11 (금)");
    expect(dashboardDate("2024-02-29")).toBe("24.02.29 (목)");
  });
});
