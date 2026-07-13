import { describe, it, expect } from "vitest";
import { resolveSettings } from "./resolve";
import { DEFAULT_SETTINGS } from "./defaults";

describe("resolveSettings", () => {
  it("저장값 없으면 DEFAULT + name은 테넌트명으로 폴백", () => {
    const r = resolveSettings(null, { name: "인재원수학" });
    expect(r.profile.name).toBe("인재원수학");
    expect(r.operations.subjects).toEqual(DEFAULT_SETTINGS.operations.subjects);
    expect(r.billing.dueDay).toBe(DEFAULT_SETTINGS.billing.dueDay);
  });

  it("name이 명시 입력되면 테넌트명 대신 그 값 사용", () => {
    const r = resolveSettings({ profile: { name: "별빛학원" } }, { name: "인재원수학" });
    expect(r.profile.name).toBe("별빛학원");
    // 나머지 profile 키는 기본값 유지
    expect(r.profile.logoText).toBe(DEFAULT_SETTINGS.profile.logoText);
  });

  it("배열은 병합이 아니라 교체된다", () => {
    const subjects = [{ key: "math", label: "수학", color: "primary" as const }];
    const r = resolveSettings({ operations: { subjects } }, { name: "X" });
    expect(r.operations.subjects).toEqual(subjects);
    // 같은 섹션의 다른 배열은 기본값 유지
    expect(r.operations.weekdayPeriods).toEqual(DEFAULT_SETTINGS.operations.weekdayPeriods);
  });

  it("중첩 객체는 일부 키만 덮어쓰고 나머지는 기본값", () => {
    const r = resolveSettings({ billing: { dueDay: 25 } }, { name: "X" });
    expect(r.billing.dueDay).toBe(25);
    expect(r.billing.taxMode).toBe(DEFAULT_SETTINGS.billing.taxMode);
    expect(r.billing.defaultMethod).toBe(DEFAULT_SETTINGS.billing.defaultMethod);
  });

  it("과목 행 역호환 — 옛 english 저장 행에 과목별 교시·강사뷰 기본값 주입, 무기본 과목은 그대로", () => {
    // 프로덕션 실저장 형태: 새 필드(weekdayPeriods·teacherViewLines·teacherViewStep) 없는 행
    const subjects = [
      { key: "english", label: "영어", color: "blue" as const, weekdayGrouping: "mon-tue" as const },
      { key: "math", label: "수학", color: "primary" as const },
    ];
    const r = resolveSettings({ operations: { subjects } }, { name: "X" });
    const [eng, math] = r.operations.subjects;
    const engDefault = DEFAULT_SETTINGS.operations.subjects.find((s) => s.key === "english")!;
    expect(eng.weekdayPeriods).toEqual(engDefault.weekdayPeriods);
    expect(eng.teacherViewLines).toEqual(engDefault.teacherViewLines);
    expect(eng.teacherViewStep).toBe(10);
    // 저장값이 이미 있으면 주입하지 않음(사용자 값 보존)
    const custom = [{ ...subjects[0], teacherViewStep: 30 as const, teacherViewLines: ["18:00"] }];
    const r2 = resolveSettings({ operations: { subjects: custom } }, { name: "X" });
    expect(r2.operations.subjects[0].teacherViewStep).toBe(30);
    expect(r2.operations.subjects[0].teacherViewLines).toEqual(["18:00"]);
    // math는 기본에 해당 필드가 없어 undefined 키 노이즈 없이 원형 유지
    expect(math).toEqual(subjects[1]);
  });

  it("입금 계좌 역호환 — 옛 단일 account만 있으면 accounts로 승격 + 기본 계좌 미러", () => {
    // 프로덕션 실저장 형태: accounts 없이 단일 account만(구버전)
    const r = resolveSettings(
      { billing: { account: { bank: "농협", holder: "원일", number: "302-1369-9501-91" } } },
      { name: "X" },
    );
    expect(r.billing.accounts).toHaveLength(1);
    expect(r.billing.accounts[0]).toMatchObject({ bank: "농협", holder: "원일", number: "302-1369-9501-91", isDefault: true });
    // 미러 — 레거시 account 필드도 기본 계좌를 가리킴(미이전 소비처 안전)
    expect(r.billing.account.bank).toBe("농협");
    expect(r.billing.account.isDefault).toBe(true);
  });

  it("입금 계좌 — accounts 목록이 있으면 기본 지정 계좌가 미러, 기본 없으면 첫 계좌", () => {
    const accounts = [
      { label: "A", bank: "국민", holder: "인재원", number: "111", isDefault: false },
      { label: "B", bank: "신한", holder: "인재원", number: "222", isDefault: true },
    ];
    const r = resolveSettings({ billing: { accounts } }, { name: "X" });
    expect(r.billing.account.bank).toBe("신한"); // isDefault 계좌가 미러
    // 기본 지정이 하나도 없으면 첫 계좌를 기본으로 승격
    const r2 = resolveSettings(
      { billing: { accounts: accounts.map((a) => ({ ...a, isDefault: false })) } },
      { name: "X" },
    );
    expect(r2.billing.accounts[0].isDefault).toBe(true);
    expect(r2.billing.account.bank).toBe("국민");
  });

  it("입금 계좌 — 저장값 없으면 빈 목록 + 빈 미러", () => {
    const r = resolveSettings(null, { name: "X" });
    expect(r.billing.accounts).toEqual([]);
    expect(r.billing.account).toEqual({ label: "", bank: "", holder: "", number: "", isDefault: false });
  });

  it("기본 객체를 변형하지 않는다(공유 참조 안전)", () => {
    resolveSettings({ profile: { name: "A" } }, { name: "B" });
    // 다음 호출에 이전 호출의 name이 새어나오면 안 됨
    const r2 = resolveSettings(null, { name: "C" });
    expect(r2.profile.name).toBe("C");
    expect(DEFAULT_SETTINGS.profile.name).toBe("");
  });
});
