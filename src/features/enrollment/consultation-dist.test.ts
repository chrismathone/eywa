import { describe, expect, it } from "vitest";
import { buildSchoolBars, gradeLabel, GRADE_UNKNOWN, sortGradeBars } from "./consultation-dist";

// 값은 전부 프로덕션 실제 표기(2026 상담 251건에서 발췌).
describe("gradeLabel — 확실할 때만 분류한다", () => {
  it("급이 붙어 있고 유효하면 그대로", () => {
    expect(gradeLabel("중2", null)).toBe("중2");
    expect(gradeLabel("초4", null)).toBe("초4");
    expect(gradeLabel("고1", null)).toBe("고1");
  });

  it("숫자만이면 **학교명에서** 급을 가져온다", () => {
    expect(gradeLabel("2", "칠성초")).toBe("초2");
    expect(gradeLabel("2", "침산중")).toBe("중2");
    expect(gradeLabel("1", "칠성고")).toBe("고1");
    expect(gradeLabel("3", "대구일중학교")).toBe("중3");
  });

  it("🔴 없는 학년은 만들지 않는다 — `초7`이 실제로 나왔었다", () => {
    expect(gradeLabel("7", "칠성초")).toBe(GRADE_UNKNOWN); // 초등 7학년은 없다
    expect(gradeLabel("초7", null)).toBe(GRADE_UNKNOWN);
    expect(gradeLabel("4", "침산중")).toBe(GRADE_UNKNOWN); // 중학교 4학년도 없다
    expect(gradeLabel("0", "칠성초")).toBe(GRADE_UNKNOWN);
  });

  it("학교를 모르면 급을 모른다 — 초2와 중2를 합치지 않는다", () => {
    expect(gradeLabel("2", null)).toBe(GRADE_UNKNOWN);
    expect(gradeLabel("2", "")).toBe(GRADE_UNKNOWN);
  });

  it("애매한 표기는 전부 분류 불가 — 추측해서 끼워 넣지 않는다", () => {
    for (const g of ["예비중1", "중등부", "7세", "기타", "미상", "", "  "])
      expect(gradeLabel(g, "칠성초"), g).toBe(GRADE_UNKNOWN);
  });
});

describe("sortGradeBars", () => {
  it("초1→고3 흐름 순, '분류 불가'는 항상 끝", () => {
    const bars = [
      { label: "고1", n: 5, enrolled: 1 },
      { label: GRADE_UNKNOWN, n: 99, enrolled: 0 },
      { label: "초2", n: 3, enrolled: 2 },
      { label: "중3", n: 7, enrolled: 4 },
    ];
    expect(sortGradeBars(bars).map((b) => b.label)).toEqual(["초2", "중3", "고1", GRADE_UNKNOWN]);
  });
});

describe("buildSchoolBars", () => {
  const rows = [
    { school: "침산초", grade: "3", enrolled: true },
    { school: "침산초등학교", grade: "4", enrolled: false }, // 같은 학교, 다른 표기
    { school: "대구침산초등학교", grade: "5", enrolled: true },
    { school: "칠성고", grade: "1", enrolled: false },
  ];

  it("🔴 같은 학교의 다른 표기를 합친다 — 안 합치면 순위도 전환율도 틀린다", () => {
    const bars = buildSchoolBars(rows, null);
    const chimsan = bars.find((b) => b.key === "침산초")!;
    expect(chimsan.n).toBe(3);
    expect(chimsan.enrolled).toBe(2);
    expect(bars).toHaveLength(2);
  });

  it("전교생 자료가 없으면 비율을 만들지 않는다(0%가 아니라 null)", () => {
    const bars = buildSchoolBars(rows, null);
    expect(bars.every((b) => b.rate === null && b.total === null)).toBe(true);
  });

  it("전교생을 주면 비율과 정식 명칭이 붙는다", () => {
    const totals = new Map([["침산초", { name: "대구침산초등학교", kind: "초", total: 1000 }]]);
    const bars = buildSchoolBars(rows, totals);
    const chimsan = bars.find((b) => b.key === "침산초")!;
    expect(chimsan.label).toBe("대구침산초등학교");
    expect(chimsan.rate).toBe(0.3); // 3/1000
    // 공시에 없는 학교는 비율 없이 건수만 — 목록에서 빼지는 않는다(실제 있었던 상담이다).
    expect(bars.find((b) => b.key === "칠성고")!.rate).toBeNull();
  });
});
