import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@/features/calendar/types";
import {
  admissionsEventBaseKind,
  admissionsEventKind,
  admissionsListKind,
  dashboardDate,
  isCancelledAdmissionsRow,
  staffDisplayRole,
  levelTestListOn,
  levelTestsOn,
  upcomingAdmissionsRows,
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
  it("레벨테스트의 실제 약칭과 첫 수업만 포함하고 차단·운영 일정은 제외한다 — 취소된 일정은 목록에 남긴다(2026-09-30)", () => {
    const included = [
      "영수입테",
      "영어 레테",
      "레벨 테스트",
      "첫 수업",
      "수학 첫수업",
      "[취소] 레테",
      "레테 취소",
    ];
    const excluded = [
      "Daily Open Briefing",
      "학부모 설명회",
      "입학 상담",
      "[취소] 학부모 설명회",
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
    expect(staffDisplayRole(user, true)).toBe("admin");
    expect(staffDisplayRole(user, false)).toBe("master");
    expect(user.system_role).toBe("master");
    expect(staffDisplayRole({ id: "other", system_role: "master" }, true)).toBe(
      "master",
    );
  });
  it("입학 일정 분류기 — 레벨테스트(입테·레테) / 첫 수업, 둘 다 적혔으면 레벨테스트", () => {
    expect(admissionsEventKind(event("영수입테"))).toBe("levelTest");
    expect(admissionsEventKind(event("영어 레테"))).toBe("levelTest");
    expect(admissionsEventKind(event("레벨 테스트"))).toBe("levelTest");
    expect(admissionsEventKind(event("입학테스트"))).toBe("levelTest");
    expect(admissionsEventKind(event("수학 첫수업"))).toBe("firstClass");
    expect(admissionsEventKind(event("첫 수업"))).toBe("firstClass");
    expect(admissionsEventKind(event("레테 후 첫수업"))).toBe("levelTest");
    expect(
      admissionsEventKind(event("김하늘", { tag: { id: "t", name: "레벨 테스트", color: "blue" } })),
    ).toBe("levelTest");
  });
  it("분류기도 취소·예약 차단·운영팀 중요일정·휴가 오버레이를 뺀다", () => {
    for (const e of [
      event("[취소] 레테"),
      event("입테 예약 금지"),
      event("첫 수업 예약차단"),
      event("레테", { source: "leave" }),
      event("레테", { tag: { id: "t", name: "01. 운영팀 중요일정", color: "blue" } }),
      event("안내문", { memo: "첫 수업 절차" }),
      event("학부모 설명회"),
    ]) {
      expect(admissionsEventKind(e)).toBeNull();
    }
  });
  it("전일 입테 = 그날(어제)을 덮는 레벨테스트만(첫 수업·다른 날 제외) — 카드와 팝업이 같은 함수", () => {
    const rows = [
      { id: "a", kind: "levelTest" as const, startDate: "2026-09-11", endDate: "2026-09-11" },
      { id: "b", kind: "firstClass" as const, startDate: "2026-09-11", endDate: "2026-09-11" },
      { id: "c", kind: "levelTest" as const, startDate: "2026-09-12", endDate: "2026-09-12" },
      { id: "d", kind: "levelTest" as const, startDate: "2026-09-10", endDate: "2026-09-11" },
      { id: "e", kind: null, startDate: "2026-09-11", endDate: "2026-09-11" },
    ];
    expect(levelTestsOn(rows, "2026-09-11").map((r) => r.id)).toEqual(["a", "d"]);
  });
  it("일정 패널 줄 = 오늘부터 — '전일 입테'용 어제 줄은 빠지고 어제부터 이어지는 일정은 남는다", () => {
    const rows = [
      { id: "y", endDate: "2026-09-10" },
      { id: "span", endDate: "2026-09-11" },
      { id: "t", endDate: "2026-09-11" },
      { id: "n", endDate: "2026-09-20" },
    ];
    expect(upcomingAdmissionsRows(rows, "2026-09-11").map((r) => r.id)).toEqual(["span", "t", "n"]);
  });
  it("취소된 일정 — 건수용 분류기는 null, 목록용 분류기는 원래 종류(차단·운영 일정은 둘 다 null)", () => {
    expect(admissionsEventKind(event("[취소] 레벨테스트 김하늘"))).toBeNull();
    expect(admissionsEventBaseKind(event("[취소] 레벨테스트 김하늘"))).toBe("levelTest");
    expect(admissionsEventBaseKind(event("수학 첫수업 취소"))).toBe("firstClass");
    expect(admissionsEventBaseKind(event("[취소] 입테 예약 금지"))).toBeNull();
    expect(admissionsEventBaseKind(event("레테", { source: "leave" }))).toBeNull();
  });
  it("목록 열·취소 줄 판정 — kind가 null이고 cancelledKind가 있으면 취소 줄", () => {
    expect(admissionsListKind({ kind: "levelTest" })).toBe("levelTest");
    expect(admissionsListKind({ kind: null, cancelledKind: "firstClass" })).toBe("firstClass");
    expect(admissionsListKind({ kind: null })).toBeNull();
    expect(isCancelledAdmissionsRow({ kind: null, cancelledKind: "levelTest" })).toBe(true);
    expect(isCancelledAdmissionsRow({ kind: "levelTest" })).toBe(false);
    expect(isCancelledAdmissionsRow({ kind: null })).toBe(false);
  });
  it("전일 입테 목록 — 숫자는 살아 있는 것만, 목록은 취소도 시간 순서 그대로, 취소 건수 따로", () => {
    const rows = [
      { id: "a", kind: "levelTest" as const, startDate: "2026-09-30", endDate: "2026-09-30" },
      { id: "x", kind: null, cancelledKind: "levelTest" as const, startDate: "2026-09-30", endDate: "2026-09-30" },
      { id: "b", kind: "levelTest" as const, startDate: "2026-09-30", endDate: "2026-09-30" },
      { id: "y", kind: null, cancelledKind: "firstClass" as const, startDate: "2026-09-30", endDate: "2026-09-30" },
      { id: "z", kind: null, cancelledKind: "levelTest" as const, startDate: "2026-10-01", endDate: "2026-10-01" },
    ];
    const list = levelTestListOn(rows, "2026-09-30");
    expect(list.active.map((r) => r.id)).toEqual(["a", "b"]);
    expect(list.rows.map((r) => r.id)).toEqual(["a", "x", "b"]);
    expect(list.cancelled).toBe(1);
    // 그날 입테가 전부 취소 — 숫자 0, 목록엔 취소 줄 하나.
    const onlyCancelled = levelTestListOn([rows[1]], "2026-09-30");
    expect(onlyCancelled.active).toHaveLength(0);
    expect(onlyCancelled.rows).toHaveLength(1);
    expect(onlyCancelled.cancelled).toBe(1);
  });
  it("날짜에 두 자리 연도와 정확한 요일을 표시한다", () => {
    expect(dashboardDate("2026-09-10")).toBe("26.09.10 (목)");
    expect(dashboardDate("2026-09-11")).toBe("26.09.11 (금)");
    expect(dashboardDate("2024-02-29")).toBe("24.02.29 (목)");
  });
});
