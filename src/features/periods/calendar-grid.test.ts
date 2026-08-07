import { describe, expect, it } from "vitest";
import {
  dragRange,
  labelMonthOf,
  monthGrid,
  overlappingMonths,
  paintedMonthOf,
  yearGrids,
} from "./calendar-grid";

describe("monthGrid — 42칸 고정", () => {
  it("어느 달이든 정확히 42칸(6주)", () => {
    for (let m = 1; m <= 12; m++) {
      expect(monthGrid(2026, m), `${m}월`).toHaveLength(42);
      expect(monthGrid(2028, m), `윤년 ${m}월`).toHaveLength(42);
    }
  });

  it("첫 칸은 항상 일요일, 마지막 칸은 토요일", () => {
    for (let m = 1; m <= 12; m++) {
      const g = monthGrid(2026, m);
      expect(g[0].dow, `${m}월 첫 칸`).toBe(0);
      expect(g[41].dow, `${m}월 끝 칸`).toBe(6);
    }
  });

  it("1일이 일요일이면 앞 꼬리가 없다", () => {
    // 2026-02-01 = 일요일
    const g = monthGrid(2026, 2);
    expect(g[0].iso).toBe("2026-02-01");
    expect(g[0].inMonth).toBe(true);
  });

  it("1일이 토요일이면 앞 꼬리가 6칸", () => {
    // 2026-08-01 = 토요일
    const g = monthGrid(2026, 8);
    expect(g.slice(0, 6).every((c) => !c.inMonth)).toBe(true);
    expect(g[6].iso).toBe("2026-08-01");
  });

  it("윤년 2월은 29일까지 담는다", () => {
    const g = monthGrid(2028, 2);
    expect(g.filter((c) => c.inMonth)).toHaveLength(29);
    expect(g.find((c) => c.iso === "2028-02-29")?.inMonth).toBe(true);
  });

  it("평년 2월엔 29일이 없다", () => {
    expect(monthGrid(2026, 2).some((c) => c.iso === "2026-02-29")).toBe(false);
  });

  // 🔴 해 넘김 — 세션이 12월에서 1월로 이어지므로 꼬리 날짜의 **연도**가 맞아야 한다.
  it("1월 판의 앞 꼬리는 전해 12월", () => {
    const g = monthGrid(2026, 1);
    const lead = g.filter((c) => !c.inMonth && c.iso < "2026-01-01");
    expect(lead.every((c) => c.iso.startsWith("2025-12"))).toBe(true);
  });

  it("12월 판의 뒤 꼬리는 다음 해 1월", () => {
    const g = monthGrid(2026, 12);
    const tail = g.filter((c) => !c.inMonth && c.iso > "2026-12-31");
    expect(tail.length).toBeGreaterThan(0);
    expect(tail.every((c) => c.iso.startsWith("2027-01"))).toBe(true);
  });

  it("날짜가 하루도 빠지거나 겹치지 않고 연속이다", () => {
    const g = monthGrid(2026, 5);
    for (let i = 1; i < g.length; i++) {
      const prev = new Date(`${g[i - 1].iso}T00:00:00Z`);
      prev.setUTCDate(prev.getUTCDate() + 1);
      expect(g[i].iso).toBe(prev.toISOString().slice(0, 10));
    }
  });

  it("day는 그 달의 일자 그대로(꼬리 칸도 자기 달 기준)", () => {
    const g = monthGrid(2026, 1);
    expect(g.find((c) => c.iso === "2025-12-31")?.day).toBe(31);
    expect(g.find((c) => c.iso === "2026-01-01")?.day).toBe(1);
  });
});

describe("yearGrids", () => {
  it("12판", () => {
    const y = yearGrids(2026);
    expect(y).toHaveLength(12);
    expect(y.map((x) => x.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(y.every((x) => x.cells.length === 42)).toBe(true);
  });
});

describe("paintedMonthOf — 어느 달력에서 보든 같은 답", () => {
  const ranges = [
    { labelMonth: 2, start: "2026-02-02", end: "2026-03-05" }, // 달을 넘는 세션
    { labelMonth: 3, start: "2026-03-09", end: "2026-04-03" },
  ];

  it("구간 안이면 그 라벨월", () => {
    expect(paintedMonthOf("2026-02-02", ranges)).toBe(2);
    expect(paintedMonthOf("2026-03-05", ranges)).toBe(2); // 3월 날짜지만 2월 세션
    expect(paintedMonthOf("2026-03-09", ranges)).toBe(3);
  });

  it("어느 세션에도 없으면 null(사이의 빈 날)", () => {
    expect(paintedMonthOf("2026-03-06", ranges)).toBeNull();
    expect(paintedMonthOf("2026-01-15", ranges)).toBeNull();
  });

  it("빈 구간은 무시한다(저장 전 깨진 행 방어)", () => {
    expect(paintedMonthOf("2026-05-01", [{ labelMonth: 5, start: "", end: "" }])).toBeNull();
  });
});

describe("dragRange / labelMonthOf", () => {
  it("거꾸로 끌어도 정방향", () => {
    expect(dragRange("2026-03-20", "2026-03-06")).toEqual({ start: "2026-03-06", end: "2026-03-20" });
    expect(dragRange("2026-03-06", "2026-03-20")).toEqual({ start: "2026-03-06", end: "2026-03-20" });
  });

  it("한 칸만 클릭해도 구간이 된다", () => {
    expect(dragRange("2026-03-06", "2026-03-06")).toEqual({ start: "2026-03-06", end: "2026-03-06" });
  });

  // 🔴 라벨월은 **시작일의 달** — 구 출석부는 '드래그를 시작한 달력'에 귀속시켜,
  //    3월 판의 후행 4월 칸에서 끌면 4월을 칠했다고 믿는데 3월에 저장됐다.
  it("라벨월은 시작일의 달이다(어느 판에서 끌었는지와 무관)", () => {
    expect(labelMonthOf("2026-03-06")).toBe(3);
    expect(labelMonthOf("2026-04-06")).toBe(4);
    expect(labelMonthOf("2025-12-29")).toBe(12);
  });
});

describe("overlappingMonths — 저장 전 겹침 경고", () => {
  const ranges = [
    { labelMonth: 2, start: "2026-02-02", end: "2026-03-05" },
    { labelMonth: 4, start: "2026-04-06", end: "2026-05-01" },
  ];

  it("다른 달과 겹치면 그 달들을 돌려준다", () => {
    expect(overlappingMonths({ labelMonth: 3, start: "2026-03-01", end: "2026-03-20" }, ranges)).toEqual([2]);
  });

  it("자기 자신은 겹침이 아니다(같은 달 다시 칠하기 = 교체)", () => {
    expect(overlappingMonths({ labelMonth: 2, start: "2026-02-09", end: "2026-03-10" }, ranges)).toEqual([]);
  });

  it("사이에 딱 들어가면 빈 배열(2월은 3/5까지, 4월은 4/6부터)", () => {
    expect(overlappingMonths({ labelMonth: 3, start: "2026-03-06", end: "2026-04-05" }, ranges)).toEqual([]);
    expect(overlappingMonths({ labelMonth: 3, start: "2026-03-09", end: "2026-04-03" }, ranges)).toEqual([]);
  });

  it("뒤 세션을 파고들면 그 달을 알린다", () => {
    expect(overlappingMonths({ labelMonth: 3, start: "2026-03-09", end: "2026-04-10" }, ranges)).toEqual([4]);
  });

  it("여러 달을 덮으면 전부 알린다", () => {
    expect(overlappingMonths({ labelMonth: 3, start: "2026-02-20", end: "2026-04-20" }, ranges)).toEqual([2, 4]);
  });

  it("양끝이 맞닿기만 해도 겹침이다(양끝 포함 구간)", () => {
    expect(overlappingMonths({ labelMonth: 3, start: "2026-03-05", end: "2026-03-20" }, ranges)).toEqual([2]);
  });
});
