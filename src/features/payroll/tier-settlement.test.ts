import { describe, it, expect } from "vitest";
import { computeTierSettlement, floor1, tierSalaryGroup, type TierRow } from "./tier-settlement";

// 시트 실측 케이스(2026-07, 강사 출석부 3종 대조로 확정 — project_attendance-sheet-to-eywa-payroll-parity).
// 급여 행 = floor1(단가 × 시수 × 0.911 × 비율%) · 정산액 = floor(Σ행).

const prices = new Map<string, number>([
  ["초등 3T", 21_250],
  ["초등 2T", 22_500],
  ["중등 3T", 24_000],
  ["고등 3T", 27_250],
  ["의치대 중등", 25_000],
  ["수학II (미적분I)", 31_250],
]);

const row = (over: Partial<TierRow>): TierRow => ({
  studentId: "s1",
  studentName: "학생",
  classId: "c1",
  tierLabel: "초등 3T",
  units: 1,
  ...over,
});

describe("tierSalaryGroup", () => {
  it("시트 티어 표기를 과정으로 매핑한다", () => {
    expect(tierSalaryGroup("초등 3T")).toBe("초등");
    expect(tierSalaryGroup("의치대 초등")).toBe("초등");
    expect(tierSalaryGroup("의치대 중등")).toBe("중등");
    expect(tierSalaryGroup("고등 2T")).toBe("고등");
    // 고교 과목명 티어 = 고등 과정(이수진 실측: 비율이 고등 47.5와 일치)
    expect(tierSalaryGroup("수학I (대수)")).toBe("고등");
    expect(tierSalaryGroup("수학II (미적분I)")).toBe("고등");
    expect(tierSalaryGroup("미적분 (미적분II)")).toBe("고등");
    expect(tierSalaryGroup("확률과 통계")).toBe("고등");
    // 특강이 다른 키워드보다 우선("중등함수특강"은 특강)
    expect(tierSalaryGroup("중등함수특강")).toBe("특강");
    expect(tierSalaryGroup("고1특강")).toBe("특강");
    expect(tierSalaryGroup(null)).toBeNull();
    expect(tierSalaryGroup("매쓰몽")).toBeNull();
  });
});

describe("computeTierSettlement — 시트 실측 행", () => {
  it("김윤하 이유빈A: 21,250×7T×0.911×45% → 60,980 (floor1)", () => {
    const r = computeTierSettlement(
      [row({ units: 7 })],
      prices,
      { groupRates: { 초등: 45 }, defaultRate: null },
    );
    // 21,250×7=148,750 ×0.911=135,511.25 ×0.45=60,980.0625 → floor1 60,980.0
    expect(r.total).toBe(60_980);
  });

  it("김은정 초등 47.5%: 21,250×5T → 45,977 (48%로 계산하면 46,461이 되는 시트 검증 케이스)", () => {
    const r = computeTierSettlement(
      [row({ units: 5 })],
      prices,
      { groupRates: { 초등: 47.5, 중등: 48 }, defaultRate: null },
    );
    expect(r.total).toBe(45_977); // floor1(96,793.75 × 0.475) = 45,977.0
  });

  it("이수진 의치대 중등 47.5%: 25,000×12T → 129,817 (시트 표시 129,818은 셀 반올림 표시)", () => {
    const r = computeTierSettlement(
      [row({ tierLabel: "의치대 중등", units: 12 })],
      prices,
      { groupRates: { 중등: 47.5 }, defaultRate: null },
    );
    expect(r.total).toBe(129_817); // floor1(273,300 × 0.475) = 129,817.5 → floor 합계 129,817
  });

  it("행별 floor1 후 합계 정수 내림 — 0.5끼리 모여도 행 단위 내림이 유지된다", () => {
    const r = computeTierSettlement(
      [
        row({ studentId: "a", tierLabel: "의치대 중등", units: 12 }), // 129,817.5
        row({ studentId: "b", tierLabel: "의치대 중등", units: 12 }), // 129,817.5
      ],
      prices,
      { groupRates: { 중등: 47.5 }, defaultRate: null },
    );
    expect(r.total).toBe(259_635); // 259,635.0 → floor
    expect(r.rowCount).toBe(2);
    expect(r.unitsTotal).toBe(24);
  });

  it("같은 학생이 두 티어(교시 분리 0.5T)면 행이 갈라져 각자의 단가로 계산된다", () => {
    const r = computeTierSettlement(
      [
        row({ studentId: "s", studentName: "안서준", tierLabel: "고등 3T", units: 9 }),
        row({ studentId: "s", studentName: "안서준", tierLabel: "중등 3T", units: 4.5 }),
      ],
      prices,
      { groupRates: { 고등: 47.5, 중등: 47.5 }, defaultRate: null },
    );
    // floor1(27,250×9×0.911×0.475)=106,126.3 + floor1(24,000×4.5×0.911×0.475)=46,734.3 → 152,860
    expect(r.total).toBe(152_860);
  });

  it("과정 비율이 없으면 기본 비율로 폴백한다", () => {
    const r = computeTierSettlement(
      [row({ units: 7 })],
      prices,
      { groupRates: null, defaultRate: 45 },
    );
    expect(r.total).toBe(60_980);
  });
});

describe("computeTierSettlement — 빠진 값은 0으로 치지 않고 명단에 올린다", () => {
  it("티어 미지정 학생은 제외 + 이름 노출 + 제외 시수 집계", () => {
    const r = computeTierSettlement(
      [
        row({ studentId: "a", studentName: "곽민주", tierLabel: null, units: 2 }),
        row({ studentId: "b", studentName: "박세하", units: 9 }),
      ],
      prices,
      { groupRates: { 초등: 45 }, defaultRate: null },
    );
    expect(r.missingTierStudents).toEqual(["곽민주"]);
    expect(r.excludedUnits).toBe(2);
    expect(r.total).toBe(78_402); // floor1(21,250×9×0.911×0.45)=floor1(78,402.9375)=78,402.9 → 78,402
  });

  it("단가표에 없는 티어·비율 없는 과정도 각각 명단으로", () => {
    const r = computeTierSettlement(
      [
        row({ studentId: "a", tierLabel: "없는티어", units: 3 }),
        row({ studentId: "b", tierLabel: "매쓰몽", units: 2 }), // 과정 매핑 불가 + 기본 비율 없음
      ],
      new Map([...prices, ["매쓰몽", 30_000]]),
      { groupRates: { 초등: 45 }, defaultRate: null },
    );
    expect(r.missingPriceTiers).toEqual(["없는티어"]);
    expect(r.missingRateGroups).toEqual(["매쓰몽"]);
    expect(r.total).toBeNull(); // 산정 가능한 행 0 → 숫자를 지어내지 않는다
    expect(r.excludedUnits).toBe(5);
  });

  it("시수 0 이하 행은 무시한다(결석만 있는 학생)", () => {
    const r = computeTierSettlement([row({ units: 0 })], prices, { groupRates: { 초등: 45 }, defaultRate: null });
    expect(r.total).toBeNull();
    expect(r.rowCount).toBe(0);
  });
});

describe("floor1", () => {
  it("소수 첫째 자리 내림 — 시트·구 attendance salary.ts와 동일", () => {
    expect(floor1(69_691.56)).toBe(69_691.5);
    expect(floor1(60_980.0625)).toBe(60_980.0);
    expect(floor1(129_817.5)).toBe(129_817.5);
  });
});
