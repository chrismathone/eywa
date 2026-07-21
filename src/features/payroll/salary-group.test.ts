import { describe, expect, it } from "vitest";
import { autoSalaryGroup, parseGroupRates, resolveClassRate } from "./salary-group";

describe("autoSalaryGroup — 반 이름에 근거가 있을 때만 판정", () => {
  it("이름에 과정이 들어 있으면 판정 — 접두어가 아니어도 된다", () => {
    expect(autoSalaryGroup("초등M 초5 BS2C")).toBe("초등");
    expect(autoSalaryGroup("중등M 중2 EL3N")).toBe("중등");
    expect(autoSalaryGroup("고등M 고1 BS4A")).toBe("고등");
    // 실데이터: 과정이 가운데 있는 반(접두어 판정이면 미분류로 빠졌다)
    expect(autoSalaryGroup("개별(초등M) 초5 BS2C")).toBe("초등");
  });
  it("수능·특강은 이름 어디에 있어도 잡고, 특강이 수능보다 구체적", () => {
    expect(autoSalaryGroup("고3 수능반")).toBe("수능");
    expect(autoSalaryGroup("겨울 특강")).toBe("특강");
    expect(autoSalaryGroup("고등M 수능특강")).toBe("특강");
  });
  it("⚠️ 코드명 영어반은 추정하지 않고 null — 학생 학년 최빈값 등으로 채우지 말 것(원장 결정)", () => {
    expect(autoSalaryGroup("JP1")).toBeNull();
    expect(autoSalaryGroup("KW6")).toBeNull();
    expect(autoSalaryGroup("LS2a")).toBeNull();
    expect(autoSalaryGroup("중고E_중1 이지대")).toBeNull(); // '중등'이 아니라 '중고E_중1' — 근거 아님
    expect(autoSalaryGroup("")).toBeNull();
    expect(autoSalaryGroup(null)).toBeNull();
  });
});

describe("resolveClassRate — 좁은 설정이 이긴다", () => {
  const groupRates = { 초등: 45, 중등: 45, 고등: 45, 수능: 48, 특강: 50 } as const;

  it("반별 수동 비율이 최우선", () => {
    const r = resolveClassRate({ className: "초등M 초5", classRate: 60, groupRates, defaultRate: 40 });
    expect(r).toEqual({ rate: 60, group: "초등", source: "class" });
  });
  it("반별이 없으면 과정별", () => {
    expect(resolveClassRate({ className: "고3 수능반", groupRates, defaultRate: 40 })).toEqual({
      rate: 48,
      group: "수능",
      source: "group",
    });
  });
  it("과정이 미분류면 강사 기본 비율로", () => {
    expect(resolveClassRate({ className: "JP1", groupRates, defaultRate: 40 })).toEqual({
      rate: 40,
      group: null,
      source: "default",
    });
  });
  it("수동 과정 지정이 이름 자동 판정을 이긴다", () => {
    expect(resolveClassRate({ className: "JP1", manualGroup: "중등", groupRates }).rate).toBe(45);
    expect(resolveClassRate({ className: "초등M 초5", manualGroup: "특강", groupRates }).rate).toBe(50);
  });
  it("셋 다 없으면 unresolved — 0으로 지어내지 않는다", () => {
    expect(resolveClassRate({ className: "JP1", groupRates })).toEqual({
      rate: null,
      group: null,
      source: "unresolved",
    });
  });
  it("과정은 잡혔는데 그 과정 비율이 비어 있으면 기본 → 없으면 unresolved", () => {
    expect(resolveClassRate({ className: "겨울 특강", groupRates: { 초등: 45 }, defaultRate: 30 }).source).toBe(
      "default",
    );
    expect(resolveClassRate({ className: "겨울 특강", groupRates: { 초등: 45 } }).source).toBe("unresolved");
  });
  it("비율 0%도 유효한 설정 — null과 구분한다", () => {
    expect(resolveClassRate({ className: "JP1", classRate: 0, defaultRate: 40 })).toMatchObject({
      rate: 0,
      source: "class",
    });
  });
});

describe("parseGroupRates — DB jsonb 방어", () => {
  it("아는 과정·유효 범위만 통과", () => {
    expect(parseGroupRates({ 초등: 45, 중등: "45.5", 없는과정: 99, 고등: 120, 수능: -1 })).toEqual({
      초등: 45,
      중등: 45.5,
    });
  });
  it("객체가 아니면 빈 값", () => {
    expect(parseGroupRates(null)).toEqual({});
    expect(parseGroupRates([1, 2])).toEqual({});
    expect(parseGroupRates("45")).toEqual({});
  });
});
