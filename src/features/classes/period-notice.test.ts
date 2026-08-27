import { describe, expect, it } from "vitest";
import { periodNotice } from "./period-notice";

const TODAY = "2026-08-27";

describe("periodNotice (운영 기간 사전 고지)", () => {
  it("교시가 없는데 날짜를 넣으면 그것부터 알린다 — 저장될 자리가 없다", () => {
    expect(
      periodNotice({ hasSlots: false, validFrom: null, validTo: "2026-09-30", today: TODAY })?.kind,
    ).toBe("no-slots");
    // 날짜가 둘 다 있어도 '교시 없음'이 이긴다(더 중요한 사실).
    expect(
      periodNotice({ hasSlots: false, validFrom: "2026-09-01", validTo: "2026-08-01", today: TODAY })?.kind,
    ).toBe("no-slots");
  });

  it("지난 배치 기록이 있는 반은 날짜를 안 넣어도 알린다 — 칸이 왜 비었는지가 그 답이다", () => {
    expect(
      periodNotice({ hasSlots: false, hasHistory: true, validFrom: null, validTo: null, today: TODAY })
        ?.kind,
    ).toBe("no-slots");
  });

  it("빈 새 반 폼에는 경고부터 띄우지 않는다", () => {
    expect(periodNotice({ hasSlots: false, validFrom: null, validTo: null, today: TODAY })).toBeNull();
  });

  it("종료일이 지난 날짜면 사라진다는 것을 미리 말한다(막지는 않는다)", () => {
    const n = periodNotice({ hasSlots: true, validFrom: null, validTo: "2026-08-07", today: TODAY });
    expect(n?.kind).toBe("past-end");
    expect(n?.text).toContain("지난 날짜");
  });

  it("오늘 종료는 경고 대상이 아니다 — valid_to는 포함 경계(오늘까지 운영)", () => {
    expect(periodNotice({ hasSlots: true, validFrom: null, validTo: TODAY, today: TODAY })).toBeNull();
  });

  it("시작일이 미래면 그때까지 안 보인다는 것을 말한다", () => {
    expect(
      periodNotice({ hasSlots: true, validFrom: "2026-09-01", validTo: null, today: TODAY })?.kind,
    ).toBe("future-start");
  });

  it("정상 입력(오늘 포함 구간)은 조용하다", () => {
    expect(
      periodNotice({ hasSlots: true, validFrom: "2026-08-01", validTo: "2026-12-31", today: TODAY }),
    ).toBeNull();
    expect(periodNotice({ hasSlots: true, validFrom: null, validTo: null, today: TODAY })).toBeNull();
  });
});
