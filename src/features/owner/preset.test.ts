/**
 * 학원 프리셋(침산 / 일반판) — 원장 2026-09-22 방향 B(*"'침산'은 그대로 두고 … 새로 시작하는 지점만 일반화"* +
 * *"이 작업을 모두 끝내더라도 침산은 아무일도 없던 것처럼 되어야해"*).
 *
 * 여기서 잠그는 것:
 *   ① 판정 규칙 — **`preset:"generic"` 표식이 있는 행만 일반판**, 그 밖(행 없음·빈 행·preset 없음)은 전부 침산
 *      (실패가 침산 쪽으로 기운다 — 적대 리뷰 2026-09-22)
 *   ② **침산 불변** — 침산 저장 행을 풀면 침산 기본값(DEFAULT_SETTINGS) 위에 얹힌 결과이고, 일반판 값이 한 칸도 안 섞인다
 *   ③ 일반판은 침산 전용 값(셔틀 노선·학칙·회당 단가·수학(심화)·영어 11교시·학교 별칭)을 물려받지 않는다
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";
import { GENERIC_SETTINGS } from "./generic-defaults";
import { lessonProfileOf } from "./lesson-profile";
import { baseSettingsFor, isGenericTenant, prepareSectionForSave, presetOfStored } from "./preset";
import { resolveSettings } from "./resolve";
import { CHINSAN_SCHOOL_SAVE_ALIASES } from "@/features/schools/school-name";
import { settingsToPeriodsConfig, weekdayTableFor, isPerPeriodSubject } from "@/features/timetable/lib/periods";
import { MODULE_BASELINE_V1, MODULE_IDS, isModuleEnabled } from "@/lib/modules";
import { isRawModuleEnabled } from "../../../scripts/_shared/module-state.mjs";

/** 침산 저장 행의 모양 — 09-22 읽기 전용 실측의 **섹션 구성**(값은 대표 몇 칸). preset·modules 키가 없다. */
const CHINSAN_LIKE_ROW = {
  version: 1,
  profile: { name: "인재원", brandColor: "#153e75", printHeader: "" },
  operations: {
    subjects: [
      { key: "math", label: "수학", color: "blue", weekdayGrouping: "mon-thu" },
      { key: "english", label: "영어", color: "rose", weekdayGrouping: "mon-tue" },
      { key: "science", label: "과학", color: "purple" },
      { key: "korean", label: "국어", color: "gold" },
    ],
    seatPins: { lab: "7099", jj: "7099" },
  },
  billing: { dueDay: 10 },
  notifications: { printHeader: "" },
  consultations: {},
  permissions: { overrides: [], userOverrides: [], specialAccess: { payslipViewerIds: [], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] } },
  report: {},
};

describe("presetOfStored — 판정 규칙", () => {
  it("preset: generic 표식이 있는 행만 일반판(학원 추가가 태어날 때 남긴다)", () => {
    expect(presetOfStored({ version: 1, preset: "generic" })).toBe("generic");
  });
  it("행이 없거나 못 읽어도 침산 — 설정 행이 에러 없이 0개로 읽혀도 침산이 일반판으로 뒤집히지 않는다", () => {
    expect(presetOfStored(null)).toBe("chinsan");
    expect(presetOfStored(undefined)).toBe("chinsan");
    expect(presetOfStored([])).toBe("chinsan");
    expect(presetOfStored("x")).toBe("chinsan");
  });
  it("행은 있는데 preset이 없으면 침산 — 침산은 DB를 한 줄도 안 건드린다", () => {
    expect(presetOfStored({})).toBe("chinsan");
    expect(presetOfStored(CHINSAN_LIKE_ROW)).toBe("chinsan");
    // 모르는 값·다른 값도 침산 쪽으로(새 값이 침산을 일반판으로 뒤집지 않게).
    expect(presetOfStored({ preset: "chinsan" })).toBe("chinsan");
    expect(presetOfStored({ preset: "whatever" })).toBe("chinsan");
  });
});

describe("침산 불변 — 저장 행이 있는 학원은 오늘과 같다", () => {
  const r = resolveSettings(CHINSAN_LIKE_ROW, { name: "인재원 침산" });

  it("침산 기본값 위에 풀린다(일반판 값이 안 섞인다)", () => {
    expect(r.preset).toBe("chinsan");
    expect(isGenericTenant(r)).toBe(false);
    expect(baseSettingsFor("chinsan")).toBe(DEFAULT_SETTINGS);
    // 저장하지 않은 칸 = 침산 기본값 그대로
    expect(r.billing.sessionPrices).toEqual(DEFAULT_SETTINGS.billing.sessionPrices);
    expect(r.billing.eieMonthlyPrice).toEqual(DEFAULT_SETTINGS.billing.eieMonthlyPrice);
    expect(r.notifications.serviceTerms).toBe(DEFAULT_SETTINGS.notifications.serviceTerms);
    expect(r.notifications.privacyTerms).toBe(DEFAULT_SETTINGS.notifications.privacyTerms);
    expect(r.operations.shuttle).toEqual(DEFAULT_SETTINGS.operations.shuttle);
    expect(r.operations.jobTitlesByDepartment).toEqual(DEFAULT_SETTINGS.operations.jobTitlesByDepartment);
    expect(r.operations.weekdayPeriods).toEqual(DEFAULT_SETTINGS.operations.weekdayPeriods);
    // 저장한 칸은 저장값
    expect(r.operations.seatPins).toEqual({ lab: "7099", jj: "7099" });
    expect(r.profile.name).toBe("인재원");
  });

  it("침산 영어 과목은 침산 기본값의 과목별 설정(영어 교시·강사뷰 가로줄)을 그대로 주입받는다", () => {
    const eng = r.operations.subjects.find((s) => s.key === "english")!;
    const engDefault = DEFAULT_SETTINGS.operations.subjects.find((s) => s.key === "english")!;
    expect(eng.weekdayPeriods).toEqual(engDefault.weekdayPeriods);
    expect(eng.teacherViewLines).toEqual(engDefault.teacherViewLines);
  });

  it("새 칸 넷은 침산 값 — 모든 모듈 켜짐 · 교시 묶음 방식 · 대구 학교 별칭 · 자동 시수", () => {
    expect(r.modules.disabled).toEqual([]);
    expect(r.operations.periodStyle).toBe("chinsan");
    expect(r.operations.schoolSaveAliases).toEqual(CHINSAN_SCHOOL_SAVE_ALIASES);
    expect(lessonProfileOf(r).autoUnits).toBe(true);
  });

  it("침산 시간표 설정 객체엔 plain 키 자체가 없다(이 작업 전과 같은 객체)", () => {
    const cfg = settingsToPeriodsConfig(r.operations);
    expect("plain" in cfg).toBe(false);
    expect(isPerPeriodSubject("math", cfg)).toBe(false);
    expect(isPerPeriodSubject("english", cfg)).toBe(true);
  });

  it("빈 행({})·행 없음(null)도 침산 — DB 조회 실패 폴백이 이 값을 넘긴다", () => {
    for (const stored of [{}, null]) {
      const empty = resolveSettings(stored, { name: "X" });
      expect(empty.preset).toBe("chinsan");
      expect(empty.operations.subjects).toEqual(DEFAULT_SETTINGS.operations.subjects);
      expect(empty.modules.disabled).toEqual([]);
    }
  });

  it("침산 저장은 새 칸 둘을 값과 무관하게 행에 남기지 않는다(origin에선 모르는 키라 스키마가 지웠다)", () => {
    const ops = { ...r.operations };
    const saved = prepareSectionForSave("chinsan", "operations", ops, ops, CHINSAN_LIKE_ROW.operations) as Record<string, unknown>;
    expect("periodStyle" in saved).toBe(false);
    expect("schoolSaveAliases" in saved).toBe(false);
    expect(saved.subjects).toEqual(r.operations.subjects);
    // 조작한 요청(침산에 교시마다 한 줄·별칭 비우기)도 행에 안 남는다 — 침산엔 되돌릴 화면이 없다
    const forged = { ...r.operations, periodStyle: "plain", schoolSaveAliases: [] };
    const out = prepareSectionForSave("chinsan", "operations", forged, forged, CHINSAN_LIKE_ROW.operations) as Record<string, unknown>;
    expect("periodStyle" in out).toBe(false);
    expect("schoolSaveAliases" in out).toBe(false);
    // 다른 섹션은 그대로
    const billing = { dueDay: 10 };
    expect(prepareSectionForSave("chinsan", "billing", billing, billing, undefined)).toBe(billing);
  });

  it("침산 기본값 문서의 침산 전용 값은 그대로 있다(누가 일반판 쪽으로 옮기면 침산이 깨진다)", () => {
    expect(DEFAULT_SETTINGS.preset).toBe("chinsan");
    expect(DEFAULT_SETTINGS.billing.sessionPrices.length).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.notifications.serviceTerms.length).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.operations.subjects.some((s) => s.key === "subject_1")).toBe(false);
    expect(DEFAULT_SETTINGS.modules.disabled).toEqual([]);
    expect(DEFAULT_SETTINGS.operations.periodStyle).toBe("chinsan");
  });
});

describe("보고서 설정의 영상 제출 대상", () => {
  it("배포 전에 연 설정 폼이 새 칸 없이 저장해도 기존 제외 대상을 보존한다", () => {
    const policy = { enabled: true, disabledSubjectKeys: ["english"],
      disabledSchoolLevels: ["high"], disabledClassIds: ["11111111-1111-4111-8111-111111111111"] };
    const stored = { ...DEFAULT_SETTINGS.report, videoHomeworkPolicy: policy };
    const oldForm = { ...DEFAULT_SETTINGS.report } as Record<string, unknown>;
    delete oldForm.videoHomeworkPolicy;
    const parsed = { ...oldForm, videoHomeworkPolicy: DEFAULT_SETTINGS.report.videoHomeworkPolicy };
    const saved = prepareSectionForSave("chinsan", "report", oldForm, parsed, stored) as Record<string, unknown>;
    expect(saved.videoHomeworkPolicy).toEqual(policy);
  });
});

describe("일반판 — 새로 연 학원", () => {
  // 학원 추가가 만드는 행 그대로
  const g = resolveSettings({ version: 1, preset: "generic" }, { name: "새학원" });

  it("표식만 있는 행은 일반판 기본값으로 풀린다", () => {
    expect(g.preset).toBe("generic");
    expect(isGenericTenant(g)).toBe(true);
    expect(g.profile.name).toBe("새학원");
    expect(g.operations.subjects.map((s) => s.key)).toEqual(["math", "english", "korean", "science"]);
  });

  it("민감 기능 담당자와 개인 메뉴 권한은 비어 있고, 옛 설정 폼 저장이 명단을 지우지 않는다", () => {
    expect(g.permissions.userOverrides).toEqual([]);
    expect(g.permissions.specialAccess).toEqual({ payslipViewerIds: [], payslipManagerIds: [], leaveAdjusterIds: [], classSplitterIds: [], enrollmentDateEditorIds: [], staffTaskMonitorIds: [], vendorViewerIds: [], jjReportManagerIds: [], beforeClassReportIds: [], withdrawalApproverIds: [], withdrawalDeskIds: [], staffSubjectScopes: [] });
    const stored = {
      userOverrides: [{ userId: "11111111-1111-4111-8111-111111111111", menu: "staff", access: "full" }],
      specialAccess: { payslipViewerIds: ["11111111-1111-4111-8111-111111111111"], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] },
    };
    const parsed = { overrides: [], userOverrides: [], specialAccess: { payslipViewerIds: [], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] } };
    const saved = prepareSectionForSave("generic", "permissions", { overrides: [] }, parsed, stored) as typeof parsed;
    expect(saved.userOverrides).toEqual(stored.userOverrides);
    expect(saved.specialAccess).toEqual({ ...stored.specialAccess, payslipManagerIds: stored.specialAccess.payslipViewerIds });
  });

  it("개인별 기능 권한은 어느 학원에서나 저장한다 — 침산도 보낸 값이 그대로 실린다(원장 2026-10-06)", () => {
    const person = "11111111-1111-4111-8111-111111111111";
    const sent = { overrides: [], userOverrides: [], specialAccess: { payslipViewerIds: [person], leaveAdjusterIds: [], classSplitterIds: [person], staffSubjectScopes: [{ userId: person, subjects: ["math"] }] } };
    for (const preset of ["chinsan", "generic"] as const) {
      const saved = prepareSectionForSave(preset, "permissions", sent, sent, {}) as typeof sent;
      expect(saved.specialAccess).toEqual({ ...sent.specialAccess, payslipManagerIds: [] });
    }
  });

  it("🔴 요청에 없던 칸은 저장돼 있던 값으로 둔다 — 새 칸을 모르는 옛 화면이 지정해 둔 사람을 지우지 않는다", () => {
    const person = "11111111-1111-4111-8111-111111111111";
    const storedSpecial = { payslipViewerIds: [person], leaveAdjusterIds: [], classSplitterIds: [person], staffSubjectScopes: [{ userId: person, subjects: ["math"] }] };
    // 옛 화면: 담당자 두 칸만 보낸다(스키마가 새 칸 둘을 빈 값으로 채운다).
    const raw = { overrides: [], userOverrides: [], specialAccess: { payslipViewerIds: [], leaveAdjusterIds: [person] } };
    const parsed = { ...raw, specialAccess: { ...raw.specialAccess, classSplitterIds: [], staffSubjectScopes: [] } };
    for (const preset of ["chinsan", "generic"] as const) {
      const saved = prepareSectionForSave(preset, "permissions", raw, parsed, { specialAccess: storedSpecial }) as typeof parsed;
      // 보낸 칸은 보낸 값으로(급여명세서는 비웠고 연차 조정은 넣었다), 안 보낸 칸은 저장돼 있던 값으로.
      // 실제 액션은 관리 필드 없는 열람 변경을 먼저 거절한다. 준비 함수만 호출하면 변경 전 관리 능력을 보존한다.
      expect(saved.specialAccess).toEqual({ payslipViewerIds: [], payslipManagerIds: [person], leaveAdjusterIds: [person], classSplitterIds: [person], staffSubjectScopes: storedSpecial.staffSubjectScopes });
      // 새 관리 칸만 명시화하고, 그 밖에 저장된 적 없는 칸은 만들지 않는다.
      const fresh = prepareSectionForSave(preset, "permissions", raw, parsed, {}) as { specialAccess: Record<string, unknown> };
      expect(Object.keys(fresh.specialAccess).sort()).toEqual(["leaveAdjusterIds", "payslipManagerIds", "payslipViewerIds"]);
    }
  });

  it("🔴 이 코드가 모르는 저장 칸도 지우지 않는다 — 저장값 위에 요청이 보낸 칸만 얹는다(칸을 더한 뒤 되돌린 배포)", () => {
    const person = "11111111-1111-4111-8111-111111111111";
    const sent = { overrides: [], userOverrides: [], specialAccess: { payslipViewerIds: [person], leaveAdjusterIds: [], classSplitterIds: [], staffSubjectScopes: [] } };
    const stored = { specialAccess: { payslipViewerIds: [], futureKeyIds: [person] } };
    for (const preset of ["chinsan", "generic"] as const) {
      const saved = prepareSectionForSave(preset, "permissions", sent, sent, stored) as { specialAccess: Record<string, unknown> };
      expect(saved.specialAccess).toEqual({ ...sent.specialAccess, payslipManagerIds: [], futureKeyIds: [person] });
    }
  });

  it("침산 전용 값을 물려받지 않는다", () => {
    expect(g.billing.sessionPrices).toEqual([]);
    expect(g.notifications.serviceTerms).toBe("");
    expect(g.notifications.privacyTerms.length).toBeGreaterThan(0); // 동의 체크가 필수라 최소 문구는 있다
    expect(g.operations.shuttle.enabled).toBe(false);
    expect(g.operations.shuttle.routes).toEqual([]);
    expect(g.operations.jobTitlesByDepartment).toEqual({});
    expect(g.operations.schoolSaveAliases).toEqual([]);
    expect(g.operations.subjects.some((s) => s.key === "subject_1")).toBe(false);
    // 영어 과목에 침산 영어 교시가 스며들지 않는다
    const eng = g.operations.subjects.find((s) => s.key === "english")!;
    expect(eng.weekdayPeriods).toBeUndefined();
    expect(eng.teacherViewLines).toBeUndefined();
  });

  it("모듈은 꺼진 채 태어나고, 보강은 독립 운영 모드로 꺼져 있으며 수업 규칙은 중립", () => {
    expect([...g.modules.disabled].sort()).toEqual(MODULE_IDS.filter(id => id !== "makeups").sort());
    expect(g.makeups.mode).toBe("off");
    expect(DEFAULT_SETTINGS.makeups.mode).toBe("off");
    expect(lessonProfileOf(g).autoUnits).toBe(false);
    const cfg = settingsToPeriodsConfig(g.operations);
    expect(cfg.plain).toBe(true);
    expect(isPerPeriodSubject("math", cfg)).toBe(true);
    // 영어는 내장 11교시가 아니라 학원 전역 교시를 쓴다
    expect(weekdayTableFor("english", cfg)).toBe(cfg.weekday);
  });

  it("일반판 학원이 저장해도(preset: generic) 일반판 기본값 위에 풀린다", () => {
    const saved = resolveSettings({ preset: "generic", billing: { dueDay: 5 } }, { name: "새학원" });
    expect(saved.preset).toBe("generic");
    expect(saved.billing.dueDay).toBe(5);
    expect(saved.billing.sessionPrices).toEqual([]);
  });

  it("새 학원 저장: 요청에 없던 새 칸은 스키마 기본값(침산 값)을 안 남긴다 — 저장돼 있던 값, 없으면 비움", () => {
    // 옛 화면이 새 칸 없이 보낸 요청 — 스키마가 침산 기본값을 채운 결과를 넘겨받는다
    const raw = { subjects: [] };
    const parsed = { subjects: [], periodStyle: "chinsan", schoolSaveAliases: [{ from: "일중", to: "대구일중" }] };
    const fresh = prepareSectionForSave("generic", "operations", raw, parsed, undefined) as Record<string, unknown>;
    expect("periodStyle" in fresh).toBe(false);
    expect("schoolSaveAliases" in fresh).toBe(false);
    const kept = prepareSectionForSave("generic", "operations", raw, parsed, { periodStyle: "plain", schoolSaveAliases: [] }) as Record<string, unknown>;
    expect(kept.periodStyle).toBe("plain");
    expect(kept.schoolSaveAliases).toEqual([]);
    // 요청에 있던 값은 그대로
    const sent = { periodStyle: "plain", schoolSaveAliases: [{ from: "가", to: "나" }] };
    expect(prepareSectionForSave("generic", "operations", sent, sent, undefined)).toEqual(sent);
  });

  it("원장이 켠 모듈만 켜진다 — 모르는 id는 버린다", () => {
    const on = resolveSettings({ preset: "generic", modules: { disabled: ["shuttle", "bogus", "shuttle"] } }, { name: "N" });
    expect(on.modules.disabled).toEqual(["shuttle"]);
    expect(on.modules.known).toEqual(MODULE_BASELINE_V1);
  });

  it("폼이 보낸 known만 정규화하고, known 없는 옛 폼은 기존 값 또는 v1 기준을 보존한다", () => {
    const parsed = { disabled: ["shuttle"], known: [] };
    const current = prepareSectionForSave("generic", "modules", { disabled: ["shuttle"], known: ["shuttle", "bogus"] }, parsed, {}) as Record<string, unknown>;
    expect(current.known).toEqual(MODULE_BASELINE_V1);

    const oldWithStored = prepareSectionForSave(
      "generic",
      "modules",
      { disabled: ["shuttle"] },
      parsed,
      { disabled: [], known: [...MODULE_BASELINE_V1, "bogus"] },
    ) as Record<string, unknown>;
    expect(oldWithStored.known).toEqual(MODULE_BASELINE_V1);
    const oldWithoutStored = prepareSectionForSave("generic", "modules", { disabled: [] }, parsed, { disabled: [] }) as Record<string, unknown>;
    expect(oldWithoutStored.known).toEqual(MODULE_BASELINE_V1);
  });

  it("앱과 raw JSON을 읽는 워커가 같은 실효 모듈 판정을 쓴다", () => {
    const fixtures = [
      null,
      { preset: "generic" },
      { preset: "generic", modules: { disabled: ["classnote"] } },
      { preset: "generic", modules: { disabled: [], known: ["bogus"] } },
    ];
    for (const stored of fixtures) {
      const app = resolveSettings(stored, { name: "시험" });
      expect(isRawModuleEnabled(stored, "classnote")).toBe(isModuleEnabled(app.modules.disabled, "classnote"));
    }
  });

  it("일반판 기본값 문서가 침산 기본값을 변형하지 않는다(공유 참조)", () => {
    expect(GENERIC_SETTINGS.operations).not.toBe(DEFAULT_SETTINGS.operations);
    expect(GENERIC_SETTINGS.billing).not.toBe(DEFAULT_SETTINGS.billing);
    expect(GENERIC_SETTINGS.notifications).not.toBe(DEFAULT_SETTINGS.notifications);
    expect(DEFAULT_SETTINGS.operations.periodStyle).toBe("chinsan");
  });
});
