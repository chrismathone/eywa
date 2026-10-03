import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 출결 휴원일 판정(2026-10-03 합의 A01) — **학원설정 휴일 목록에 있는 날만** 휴원일이다.
 * 법정 고정 공휴일(양력)이라는 이유만으로 쉬는 날로 추정하지 않는다(2026-08-14 폴백 제거).
 */
const m = vi.hoisted(() => ({
  holidays: [] as { date: string; name?: string }[],
  fail: false,
}));
vi.mock("@/features/owner/server/queries", () => ({
  getTenantSettings: async () => {
    if (m.fail) throw new Error("settings unavailable");
    return { operations: { holidays: m.holidays } };
  },
}));
import { holidayNameOf, holidayNameOrNull } from "./holiday";

beforeEach(() => {
  m.fail = false;
  m.holidays = [
    { date: "2026-10-03", name: "개천절" },
    { date: "2026-10-05", name: "" },
  ];
});

describe("휴원일 = 학원설정 휴일 목록", () => {
  it("목록에 있는 날은 그 이름으로 휴원일이다(이름이 비면 휴일)", async () => {
    expect(await holidayNameOf("2026-10-03")).toBe("개천절");
    expect(await holidayNameOf("2026-10-05")).toBe("휴일");
  });

  it("🔴 목록에 없는 법정 고정 공휴일은 휴원일이 아니다 — 평일과 같은 보드가 선다", async () => {
    // 2026-08-14엔 양력 고정 공휴일(1/1·3/1·5/5·6/6·8/15·10/3·10/9·12/25)을 코드가 대신 쉬게 했다.
    for (const date of ["2026-10-09", "2026-12-25", "2027-01-01", "2027-03-01", "2027-05-05", "2027-06-06", "2026-08-15"]) {
      expect(await holidayNameOf(date), date).toBeNull();
    }
  });

  it("목록에서 그날을 빼면 그날은 열린다(목록이 유일한 조작 수단)", async () => {
    m.holidays = m.holidays.filter((h) => h.date !== "2026-10-03");
    expect(await holidayNameOf("2026-10-03")).toBeNull();
  });

  it("휴일 목록이 비어 있으면 어느 날도 휴원일이 아니다(설정을 저장한 적 없는 지점)", async () => {
    m.holidays = [];
    expect(await holidayNameOf("2026-10-03")).toBeNull();
  });

  it("평일은 null", async () => {
    expect(await holidayNameOf("2026-10-06")).toBeNull();
  });
});

describe("설정 조회 실패", () => {
  it("엄격한 판은 던진다(오늘 출결 — 호출부가 정한다)", async () => {
    m.fail = true;
    await expect(holidayNameOf("2026-10-03")).rejects.toThrow("settings unavailable");
  });

  it("fail-soft 판은 휴원일이 아닌 것으로 본다 — 설정 하나로 처리 현황이 죽지 않는다", async () => {
    m.fail = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await holidayNameOrNull("2026-10-03")).toBeNull();
    // 조용히 넘기지는 않는다 — 실패는 로그에 남는다.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
