import { describe, expect, it } from "vitest";
import {
  addYears,
  currentContract,
  daysUntil,
  nextContractDefault,
  contractsOnly,
  periodLabel,
  type ContractRow,
} from "./contract";

const row = (seq: number, startDate: string, endDate: string): ContractRow => ({
  id: `c${seq}`,
  seq,
  kind: "contract",
  startDate,
  endDate,
  terms: null,
  memo: null,
  lineNo: null,
});

/** 기간 없는 이력 한 줄(시트 히스토리의 '입사'·'인센티브 수당' 같은 줄). */
const note = (terms: string, startDate: string | null = null): ContractRow => ({
  id: `n-${terms}`,
  seq: 0,
  kind: "note",
  startDate,
  endDate: null,
  terms,
  memo: null,
  lineNo: 0,
});

describe("addYears", () => {
  it("1년을 더한다", () => {
    expect(addYears("2026-06-06", 1)).toBe("2027-06-06");
    expect(addYears("2026-06-06", 3)).toBe("2029-06-06");
  });

  it("2월 29일은 평년에 28일로 맞춘다(없는 날짜 방지)", () => {
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(addYears("2024-02-29", 4)).toBe("2028-02-29");
  });

  it("형식이 아니면 빈 문자열", () => {
    expect(addYears("2026/06/06", 1)).toBe("");
  });
});

describe("currentContract", () => {
  it("저장된 계약이 없으면 입사일 기준 1차(입사일 ~ +1년)", () => {
    expect(currentContract([], "2026-06-06")).toEqual({
      seq: 1,
      startDate: "2026-06-06",
      endDate: "2027-06-06",
      stored: false,
    });
  });

  it("저장된 계약이 있으면 가장 큰 차수가 현재계약", () => {
    const rows = [row(1, "2024-03-02", "2025-03-02"), row(2, "2025-03-02", "2026-03-02")];
    expect(currentContract(rows, "2024-03-02")).toEqual({
      seq: 2,
      startDate: "2025-03-02",
      endDate: "2026-03-02",
      stored: true,
    });
  });

  it("저장된 기간이 입사일 파생과 달라도 저장된 값이 이긴다(수기 기간 우선)", () => {
    const rows = [row(1, "2024-03-02", "2024-09-01")]; // 6개월 계약
    expect(currentContract(rows, "2024-03-02")?.endDate).toBe("2024-09-01");
  });

  it("입사일이 없으면 null", () => {
    expect(currentContract([], null)).toBeNull();
    expect(currentContract([], "")).toBeNull();
    expect(currentContract([], "미정")).toBeNull();
  });
});

describe("nextContractDefault", () => {
  it("현재 계약이 끝나는 날부터 1년, 차수는 +1", () => {
    expect(nextContractDefault([], "2026-06-06")).toEqual({
      seq: 2,
      startDate: "2027-06-06",
      endDate: "2028-06-06",
    });
  });

  it("저장된 최신 차수를 이어받는다", () => {
    const rows = [row(1, "2024-03-02", "2025-03-02"), row(2, "2025-03-02", "2026-03-02")];
    expect(nextContractDefault(rows, "2024-03-02")).toEqual({
      seq: 3,
      startDate: "2026-03-02",
      endDate: "2027-03-02",
    });
  });

  it("입사일도 계약도 없으면 null", () => {
    expect(nextContractDefault([], null)).toBeNull();
  });
});

describe("daysUntil", () => {
  it("남은 일수 / 지난 일수", () => {
    expect(daysUntil("2026-08-01", "2026-07-29")).toBe(3);
    expect(daysUntil("2026-07-29", "2026-07-29")).toBe(0);
    expect(daysUntil("2026-07-01", "2026-07-29")).toBe(-28);
  });

  it("형식이 아니면 null", () => {
    expect(daysUntil("", "2026-07-29")).toBeNull();
  });
});

describe("periodLabel", () => {
  it("기간 한 줄", () => {
    expect(periodLabel({ startDate: "2026-06-06", endDate: "2027-06-06" })).toBe("2026-06-06 ~ 2027-06-06");
  });
});

describe("note(기간 없는 이력 줄)", () => {
  it("현재계약 판정에서 제외된다 — 이력 목록 표시 전용", () => {
    const rows = [note("1) 2024.01.02 입사", "2024-01-02"), note("인센티브 수당: 강좌당 추가")];
    // 기간 있는 계약이 하나도 없으므로 입사일 파생으로 떨어져야 한다.
    expect(currentContract(rows, "2024-01-02")).toEqual({
      seq: 1,
      startDate: "2024-01-02",
      endDate: "2025-01-02",
      stored: false,
    });
  });

  it("계약과 섞여 있어도 계약만 보고 차수를 센다", () => {
    const rows = [row(1, "2024-03-02", "2025-03-02"), note("2) 컨텐츠개발팀 이전", "2025-02-17")];
    expect(currentContract(rows, "2024-03-02")?.seq).toBe(1);
    expect(nextContractDefault(rows, "2024-03-02")?.seq).toBe(2);
  });

  it("contractsOnly는 기간이 반쪽인 행도 걸러낸다", () => {
    const half: ContractRow = { ...row(9, "2024-01-01", "2025-01-01"), endDate: null };
    expect(contractsOnly([half])).toEqual([]);
  });
});
