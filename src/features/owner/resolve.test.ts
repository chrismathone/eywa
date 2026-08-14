import { describe, it, expect } from "vitest";
import { resolveSettings } from "./resolve";
import { accountForTarget } from "./settings-types";
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

  it("자리 출석부 PIN은 저장 없으면 기본 7099", () => {
    const r = resolveSettings(null, { name: "X" });
    expect(r.operations.seatPins.lab).toBe("7099");
    const r2 = resolveSettings({ operations: { seatPins: { lab: "1234" } } }, { name: "X" });
    expect(r2.operations.seatPins.lab).toBe("1234");
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

  it("입금 계좌 역호환 — 옛 단일 account만 있으면 accounts로 승격(targets 미지정) + 첫 계좌 미러", () => {
    // 프로덕션 실저장 형태: accounts 없이 단일 account만(구버전)
    const r = resolveSettings(
      { billing: { account: { bank: "농협", holder: "원일", number: "302-1369-9501-91" } } },
      { name: "X" },
    );
    expect(r.billing.accounts).toHaveLength(1);
    expect(r.billing.accounts[0]).toMatchObject({ bank: "농협", holder: "원일", number: "302-1369-9501-91", targets: [] });
    expect(r.billing.account.bank).toBe("농협"); // 미러 = 첫 계좌
  });

  it("입금 계좌 배선 — accountForTarget이 targets 지정 계좌를, 미지정 소비처는 첫 계좌로 폴백", () => {
    const accounts = [
      { label: "메인", bank: "국민", holder: "인재원", number: "111", targets: [] },
      { label: "교재비", bank: "신한", holder: "인재원", number: "222", targets: ["textbook"] },
    ];
    const r = resolveSettings({ billing: { accounts } }, { name: "X" });
    expect(accountForTarget(r.billing, "textbook").bank).toBe("신한"); // 배선된 계좌
    expect(accountForTarget(r.billing, "quote").bank).toBe("국민"); // 미배선 → 첫 계좌 폴백
    expect(r.billing.account.bank).toBe("국민"); // 미러 = 첫 계좌
  });

  it("입금 계좌 — 알 수 없는 target 키는 걸러진다", () => {
    const accounts = [{ label: "", bank: "우리", holder: "인재원", number: "333", targets: ["textbook", "bogus"] }];
    const r = resolveSettings({ billing: { accounts } }, { name: "X" });
    expect(r.billing.accounts[0].targets).toEqual(["textbook"]);
  });

  it("입금 계좌 — 저장값 없으면 빈 목록 + 빈 미러", () => {
    const r = resolveSettings(null, { name: "X" });
    expect(r.billing.accounts).toEqual([]);
    expect(r.billing.account).toEqual({ label: "", bank: "", holder: "", number: "", targets: [] });
  });

  it("기본 객체를 변형하지 않는다(공유 참조 안전)", () => {
    resolveSettings({ profile: { name: "A" } }, { name: "B" });
    // 다음 호출에 이전 호출의 name이 새어나오면 안 됨
    const r2 = resolveSettings(null, { name: "C" });
    expect(r2.profile.name).toBe("C");
    expect(DEFAULT_SETTINGS.profile.name).toBe("");
  });
});
