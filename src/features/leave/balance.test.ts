import { describe, expect, it } from "vitest";
import {
  deltaForTotal,
  formatSignedDays,
  grantedTotal,
  leaveRowMatchesPeriod,
  periodMidpoint,
  remainingDays,
  roundDays,
  sumAdjustments,
} from "./balance";

describe("연차 조정 합계", () => {
  it("행이 없으면 0", () => {
    expect(sumAdjustments([])).toBe(0);
  });

  it("+와 −가 섞여도 합이 곧 조정값", () => {
    expect(sumAdjustments([{ days: 3 }, { days: -1 }, { days: 0.5 }])).toBe(2.5);
  });

  it("🔴 반반차(0.25) 해상도를 잃지 않는다 — 부동소수 누적도 끊는다", () => {
    expect(sumAdjustments([{ days: 0.25 }, { days: 0.1 }, { days: 0.2 }])).toBe(0.55);
  });

  it("숫자가 아닌 값은 0으로 본다(조회 실패 행이 합계를 NaN으로 오염시키지 않게)", () => {
    expect(sumAdjustments([{ days: Number.NaN }, { days: 2 }])).toBe(2);
  });
});

describe("총 부여 = 법정 + 조정", () => {
  it("조정이 없으면 법정 그대로", () => {
    expect(grantedTotal(15, 0)).toBe(15);
  });

  it("이월 3일이면 18일", () => {
    expect(grantedTotal(15, 3)).toBe(18);
  });

  it("차감이 부여보다 커도 음수로 내려가지 않는다", () => {
    expect(grantedTotal(11, -20)).toBe(0);
  });
});

describe("잔여", () => {
  it("총 부여 − 사용 − 결재중", () => {
    expect(remainingDays({ granted: 18, used: 3, pending: 1.5 })).toBe(13.5);
  });

  it("초과 사용은 0에서 멈춘다(음수 잔여를 화면에 내보내지 않는다)", () => {
    expect(remainingDays({ granted: 15, used: 15, pending: 1 })).toBe(0);
  });
});

describe("‘총 N일로’ → 적을 가감", () => {
  it("현재 15일을 18일로 = +3", () => {
    expect(deltaForTotal(18, 15)).toBe(3);
  });

  it("현재 18일을 15일로 = −3", () => {
    expect(deltaForTotal(15, 18)).toBe(-3);
  });

  it("같은 값이면 0 — 호출부가 ‘바뀌는 게 없다’로 거른다", () => {
    expect(deltaForTotal(15, 15)).toBe(0);
  });

  it("0.25 단위가 보존된다", () => {
    expect(deltaForTotal(15.25, 15)).toBe(0.25);
  });
});

describe("가감 표기", () => {
  it("양수엔 +, 음수엔 빼기표(−)", () => {
    expect(formatSignedDays(3)).toBe("+3일");
    expect(formatSignedDays(-1.5)).toBe("−1.5일");
  });

  it("0.25가 0.3으로 왜곡되지 않는다", () => {
    expect(formatSignedDays(0.25)).toBe("+0.25일");
  });

  it("0은 부호 없이", () => {
    expect(formatSignedDays(0)).toBe("0일");
  });
});

describe("반올림", () => {
  it("소수 둘째 자리까지", () => {
    expect(roundDays(0.1 + 0.2)).toBe(0.3);
    expect(roundDays(15.005)).toBe(15.01);
  });
});

describe("한 줄이 어느 구간에 붙나 — 중앙 날짜", () => {
  // 입사일 2026-01-02 스케줄로 적힌 줄.
  const rowA = { periodStart: "2026-01-02", periodEnd: "2027-01-01" };
  // 입사일 2026-01-15 스케줄로 적힌 줄.
  const rowB = { periodStart: "2026-01-15", periodEnd: "2027-01-14" };

  const p = (start: string, end: string) => ({ start, end });

  it("입사일이 안 바뀌면 자기 구간에만 붙는다(종전과 동일)", () => {
    expect(leaveRowMatchesPeriod(rowA, p("2026-01-02", "2027-01-01"))).toBe(true);
    expect(leaveRowMatchesPeriod(rowA, p("2025-01-02", "2026-01-01"))).toBe(false);
    expect(leaveRowMatchesPeriod(rowA, p("2027-01-02", "2028-01-01"))).toBe(false);
  });

  it("🔴 입사일을 **뒤로** 정정해도 그 구간이 물려받는다(01-02 → 01-15)", () => {
    expect(leaveRowMatchesPeriod(rowA, p("2026-01-15", "2027-01-14"))).toBe(true);
    expect(leaveRowMatchesPeriod(rowA, p("2027-01-15", "2028-01-14"))).toBe(false);
  });

  it("🔴 입사일을 **앞으로** 정정해도 마찬가지 — 다음 해로 유령이 넘어가지 않는다(01-15 → 01-02)", () => {
    // 1차 수정안('창이 구간 시작일을 품는가')은 여기서 false/true로 뒤집혀, 올해 사용이 0으로 리셋되고
    // 그 일수가 내년 잔여를 깎았다(적대 리뷰 2026-09-08).
    expect(leaveRowMatchesPeriod(rowB, p("2026-01-02", "2027-01-01"))).toBe(true);
    expect(leaveRowMatchesPeriod(rowB, p("2027-01-02", "2028-01-01"))).toBe(false);
  });

  it("어떤 줄도 두 구간에 동시에 붙지 않는다(중복 계산 불가)", () => {
    const periods = [
      p("2025-01-02", "2026-01-01"),
      p("2026-01-02", "2027-01-01"),
      p("2027-01-02", "2028-01-01"),
    ];
    for (const row of [rowA, rowB]) {
      expect(periods.filter((x) => leaveRowMatchesPeriod(row, x))).toHaveLength(1);
    }
  });

  it("창을 못 읽으면 시작일 일치로 보수적 폴백(남의 구간에 안 섞는다)", () => {
    const broken = { periodStart: "2026-01-02", periodEnd: "not-a-date" };
    expect(leaveRowMatchesPeriod(broken, p("2026-01-02", "2027-01-01"))).toBe(true);
    expect(leaveRowMatchesPeriod(broken, p("2026-01-15", "2027-01-14"))).toBe(false);
  });

  it("중앙 날짜는 창 안에 있다", () => {
    expect(periodMidpoint(rowA)).toBe("2026-07-03");
    expect(periodMidpoint({ periodStart: "2026-03-01", periodEnd: "2026-03-01" })).toBe("2026-03-01");
    expect(periodMidpoint({ periodStart: "2026-03-05", periodEnd: "2026-03-01" })).toBeNull();
  });
});
