import { describe, it, expect } from "vitest";
import { resolvePeriodLabel, tableToEntries, type PeriodTables } from "./period-label";

// 실 테넌트(injaewon) 설정 그대로 — 영어 평일 40분 단위 / 주말 1시간 단위
const tables: PeriodTables = {
  weekday: [
    { id: "1", startTime: "14:20", endTime: "15:00" },
    { id: "2", startTime: "15:00", endTime: "15:40" },
    { id: "3", startTime: "15:40", endTime: "16:20" },
    { id: "9", startTime: "19:20", endTime: "20:10" },
  ],
  weekend: [
    { id: "1", startTime: "09:00", endTime: "10:00" },
    { id: "2", startTime: "10:00", endTime: "11:00" },
    { id: "7", startTime: "15:00", endTime: "16:00" },
    { id: "8", startTime: "16:00", endTime: "17:00" },
  ],
};

describe("resolvePeriodLabel — 주말", () => {
  it("🔴 주말 15:00~16:00은 주말 7교시 — 평일 2교시(15:00~15:40)로 부르면 안 된다(이 버그의 본체)", () => {
    expect(resolvePeriodLabel("15:00", "16:00", tables, true)).toBe("7교시");
  });

  it("평일표에 없어 라벨이 증발하던 주말 이른 교시도 이제 붙는다", () => {
    expect(resolvePeriodLabel("10:00", "11:00", tables, true)).toBe("2교시");
    expect(resolvePeriodLabel("09:00", "10:00", tables, true)).toBe("1교시");
  });

  it("주말인데 영어 평일 시각을 쓰는 반 — 시작+종료가 정확히 맞으면 평일표를 교차 참조", () => {
    expect(resolvePeriodLabel("14:20", "15:00", tables, true)).toBe("1교시");
    expect(resolvePeriodLabel("15:00", "15:40", tables, true)).toBe("2교시"); // 주말 7교시(~16:00)와 구분
    expect(resolvePeriodLabel("15:40", "16:20", tables, true)).toBe("3교시");
  });
});

describe("resolvePeriodLabel — 평일(기존 동작 유지)", () => {
  it("평일은 평일표", () => {
    expect(resolvePeriodLabel("19:20", "20:10", tables, false)).toBe("9교시");
    expect(resolvePeriodLabel("15:00", "15:40", tables, false)).toBe("2교시");
  });

  it("평일에 주말표를 시작만 보고 끌어오지 않는다(시각이 다른 교시에 남의 번호 금지)", () => {
    // 평일 10:00 수업은 평일표에 없다 → 주말 2교시(10:00~11:00)를 빌려오면 안 되고, 종료가 다르면 라벨 없음
    expect(resolvePeriodLabel("10:00", "10:40", tables, false)).toBeNull();
  });

  it("시작+종료가 정확히 같으면 평일에서도 교차 참조는 허용(강한 신호)", () => {
    expect(resolvePeriodLabel("10:00", "11:00", tables, false)).toBe("2교시");
  });
});

describe("resolvePeriodLabel — 경계", () => {
  it("종료 미상(고아 슬롯)은 그 요일 표에서 시작만으로 찾는다", () => {
    expect(resolvePeriodLabel("15:00", null, tables, true)).toBe("7교시");
    expect(resolvePeriodLabel("15:00", null, tables, false)).toBe("2교시");
  });

  it("어느 표에도 없으면 라벨 없음 — 지어내지 않는다", () => {
    expect(resolvePeriodLabel("03:00", "04:00", tables, true)).toBeNull();
    expect(resolvePeriodLabel("03:00", null, tables, false)).toBeNull();
  });
});

describe("resolvePeriodLabel — 학원설정 교시 이름(2026-08-13)", () => {
  // 교시 이름은 학원설정이 단일 소스다(하드코딩 금지). 코드가 번호를 지어내는 건 이름이 없는 내장표뿐.
  const named: PeriodTables = {
    weekday: [
      { id: "4", startTime: "16:20", endTime: "17:00", label: "EiE 4교시" },
      { id: "7", startTime: "16:20", endTime: "17:20", label: "" }, // 학원장이 이름을 비움
    ],
    weekend: [],
  };

  it("이름이 있으면 번호가 아니라 그 이름", () => {
    expect(resolvePeriodLabel("16:20", "17:00", named, false)).toBe("EiE 4교시");
  });

  it("이름을 비우면 라벨 없음(null) — 화면이 시각만 그린다", () => {
    expect(resolvePeriodLabel("16:20", "17:20", named, false)).toBeNull();
  });

  it("이름 칸이 없는 내장표는 그대로 `N교시`(무회귀)", () => {
    expect(resolvePeriodLabel("15:00", "16:00", tables, true)).toBe("7교시");
  });
});

describe("tableToEntries", () => {
  it("Record<id, {start,end}> → 배열(id 보존)", () => {
    expect(tableToEntries({ "1": { startTime: "09:00", endTime: "10:00" } })).toEqual([
      { id: "1", startTime: "09:00", endTime: "10:00" },
    ]);
  });

  it("빈 이름도 그대로 옮긴다 — 없는 것과 뜻이 다르다", () => {
    expect(tableToEntries({ "1": { startTime: "09:00", endTime: "10:00", label: "" } })).toEqual([
      { id: "1", startTime: "09:00", endTime: "10:00", label: "" },
    ]);
  });
});
