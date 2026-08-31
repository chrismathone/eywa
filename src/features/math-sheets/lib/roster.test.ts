import { describe, expect, it } from "vitest";
import { effectiveEndDate, isOnMathRoster, rosterAnchorOf } from "./roster";

const E = (startDate: string, endDate: string | null = null, isTransferred = false) => ({
  startDate,
  endDate,
  isTransferred,
});

describe("rosterAnchorOf — 오늘을 보고 있는 달 안으로 접는다", () => {
  it("이번 달이면 오늘", () => {
    expect(rosterAnchorOf("2026-08", "2026-08-31")).toBe("2026-08-31");
    expect(rosterAnchorOf("2026-08", "2026-08-05")).toBe("2026-08-05");
  });

  it("🔴 지난 달이면 말일 — 오늘로 판정하면 그 달 내내 다닌 학생이 통째로 사라진다", () => {
    expect(rosterAnchorOf("2026-08", "2026-09-15")).toBe("2026-08-31");
    expect(rosterAnchorOf("2026-02", "2026-09-15")).toBe("2026-02-28");
  });

  it("다음 달이면 1일(그 달에 들어오는 학생이 보여야 한다)", () => {
    expect(rosterAnchorOf("2026-09", "2026-08-31")).toBe("2026-09-01");
  });
});

describe("effectiveEndDate — 수강 종료와 학원 퇴원 중 이른 것", () => {
  it("둘 다 있으면 이른 쪽", () => {
    expect(effectiveEndDate("2026-08-20", "2026-08-10")).toBe("2026-08-10");
    expect(effectiveEndDate("2026-08-05", "2026-08-10")).toBe("2026-08-05");
  });

  it("한쪽만 있으면 그것", () => {
    expect(effectiveEndDate(null, "2026-08-10")).toBe("2026-08-10");
    expect(effectiveEndDate("2026-08-20", null)).toBe("2026-08-20");
    expect(effectiveEndDate(null, null)).toBeNull();
  });
});

describe("isOnMathRoster — 재원생만", () => {
  it("끝난 적 없으면 재원", () => {
    expect(isOnMathRoster([E("2026-03-01")], null, "2026-08-31")).toBe(true);
  });

  it("🔴 수업이 종료됐으면 안 나온다", () => {
    expect(isOnMathRoster([E("2026-03-01", "2026-07-31")], null, "2026-08-31")).toBe(false);
  });

  it("🔴 반이동 전출은 종료일 당일부터 옛 반에서 빠진다", () => {
    // 실측 선례: 이연아 2026-05-04 ~ 2026-08-19 (is_transferred) — 8/19부터 옛 반에 없다.
    expect(isOnMathRoster([E("2026-05-04", "2026-08-19", true)], null, "2026-08-19")).toBe(false);
    expect(isOnMathRoster([E("2026-05-04", "2026-08-19", true)], null, "2026-08-18")).toBe(true);
    // 일반 종료는 당일까지 재원 — 전출과 규약이 다르다.
    expect(isOnMathRoster([E("2026-05-04", "2026-08-19", false)], null, "2026-08-19")).toBe(true);
  });

  it("🔴 학원 퇴원은 수강에 종료일이 없어도 잡는다", () => {
    expect(isOnMathRoster([E("2026-03-01")], "2026-08-10", "2026-08-31")).toBe(false);
    expect(isOnMathRoster([E("2026-03-01")], "2026-08-10", "2026-08-09")).toBe(true);
  });

  it("아직 시작 전이면 안 나온다", () => {
    // 실측 선례: 김동리·권민서A 2026-09-01 시작 — 8월 시트에 서면 안 된다.
    expect(isOnMathRoster([E("2026-09-01")], null, "2026-08-31")).toBe(false);
    expect(isOnMathRoster([E("2026-09-01")], null, "2026-09-01")).toBe(true);
  });

  it("나갔다 돌아왔으면 지금 구간으로 판정한다", () => {
    const two = [E("2026-03-01", "2026-06-30"), E("2026-08-24")];
    expect(isOnMathRoster(two, null, "2026-08-31")).toBe(true);
    expect(isOnMathRoster(two, null, "2026-07-15")).toBe(false);
  });

  it("start_date가 없는 행은 근거로 쓰지 않는다", () => {
    expect(isOnMathRoster([{ startDate: null, endDate: null, isTransferred: false }], null, "2026-08-31")).toBe(false);
  });

  it("수강이 하나도 없으면 재원이 아니다", () => {
    expect(isOnMathRoster([], null, "2026-08-31")).toBe(false);
  });
});
