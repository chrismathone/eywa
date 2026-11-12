// 저장된 부분 설정(jsonb)을 **그 학원 프리셋의 기본값**에 deep-merge해 "완전한" 설정으로 해석.
// 배열·원시는 저장값이 있으면 교체, 객체는 재귀 병합. 기본 객체는 절대 변형하지 않는다(공유 참조).
// 프리셋(preset.ts): 침산 = DEFAULT_SETTINGS(오늘과 같다), 새 학원 = GENERIC_SETTINGS.
import { baseSettingsFor, presetOfStored } from "./preset";
import { effectiveDisabledModulesFromStored, knownModulesFromStored, type ModuleId } from "@/lib/modules";
import { normalizeNavigationSettings } from "./normalize-navigation";
import { normalizeDashboard } from "@/features/dashboard/layout/normalize";
import type { AccountSetting, BillingSettings, SubjectSetting, TenantSettings } from "./settings-types";
import { normalizeMakeupSettings } from "@/features/makeups/config";
import { effectivePayslipManagerIds } from "./payslip-permissions";
import { studentStatusManagerIds } from "./student-status-permissions";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, stored: unknown): T {
  if (!isPlainObject(base)) {
    return stored === undefined || stored === null ? base : (stored as T);
  }
  if (!isPlainObject(stored)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(base as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[key];
    const s = stored[key];
    if (s === undefined) continue;
    if (Array.isArray(b)) out[key] = Array.isArray(s) ? s : b;
    else if (isPlainObject(b)) out[key] = deepMerge(b, s);
    else out[key] = s === null ? b : s;
  }
  return out as T;
}

/**
 * 부서별 직급은 **열린 키(record)** 다 — deepMerge는 기본값의 키만 순회하므로, 기본값이 `{}`인 일반판에서는
 * 저장한 부서가 읽을 때 전부 떨어졌다(저장 토스트는 뜨고 새로 열면 빈 칸). 이 칸만 좁게 다시 얹는다:
 * 저장값이 객체일 때 **값이 문자열 배열인 키만** 기본값 위에 덮는다(빈 배열은 명시값으로 보존). 기본 객체는 변형하지 않는다.
 */
function mergeDepartmentTitles(base: Record<string, string[]>, stored: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = { ...base };
  if (!isPlainObject(stored)) return out;
  for (const [department, titles] of Object.entries(stored)) {
    if (Array.isArray(titles) && titles.every((t) => typeof t === "string")) out[department] = titles as string[];
  }
  return out;
}

// 공휴일 역호환 — 옛 저장형식 string[]("YYYY-MM-DD")를 {date,name}로 승격. 신형식 객체는 그대로.
// (deepMerge는 배열을 통째 교체하므로 옛 데이터가 그대로 흘러옴 → 여기서 형태 보장.)
function normalizeHolidays(arr: unknown): { date: string; name: string }[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((h) => {
      if (typeof h === "string") return { date: h, name: "" };
      if (h && typeof h === "object" && typeof (h as { date?: unknown }).date === "string") {
        const o = h as { date: string; name?: unknown };
        return { date: o.date, name: typeof o.name === "string" ? o.name : "" };
      }
      return null;
    })
    .filter((h): h is { date: string; name: string } => h !== null);
}

// 과목 행 역호환 — deepMerge가 배열을 통째 교체하므로, 새 과목별 필드(weekdayPeriods·
// teacherViewLines·teacherViewStep, 2026-07-06)가 없는 옛 저장 행을 key 기반 기본값으로 채운다.
// (normalizeHolidays와 같은 "읽기 시 승격" 패턴.) english=기본 교시/가로줄/step 주입 →
// 폼·소비처가 프리필된 값을 본다. 기타 과목의 weekdayPeriods는 undefined 유지(=전역 폴백 의미 보존).
function normalizeSubjects(arr: SubjectSetting[], base: TenantSettings): SubjectSetting[] {
  // 🔴 주입 재료는 **그 학원 프리셋의** 과목 기본값이다 — 침산은 DEFAULT_SETTINGS(영어 11교시·가로줄)로 오늘과 같고,
  //    새 학원은 GENERIC_SETTINGS(과목별 부가 설정 없음)라 침산 영어 교시가 새 학원 영어 과목에 스며들지 않는다.
  const defaults = new Map(base.operations.subjects.map((s) => [s.key, s]));
  return arr.map((s) => {
    const d = defaults.get(s.key);
    if (!d) return s;
    // 기본값이 실제로 있는 필드만 주입(없는 과목 행에 undefined 키 노이즈를 만들지 않는다).
    // 소비처는 어차피 `?? 10` 등으로 폴백하므로 무기본 과목은 미설정 그대로가 정확한 상태.
    const out: SubjectSetting = { ...s };
    if (out.weekdayPeriods === undefined && d.weekdayPeriods) out.weekdayPeriods = d.weekdayPeriods;
    if (out.teacherViewLines === undefined && d.teacherViewLines) out.teacherViewLines = d.teacherViewLines;
    if (out.teacherViewStep === undefined && d.teacherViewStep !== undefined) out.teacherViewStep = d.teacherViewStep;
    return out;
  });
}

// 입금 계좌 역호환/정규화 — 옛 단일 계좌(account)만 있던 테넌트를 다계좌 목록(accounts)으로 승격하고,
// 계좌마다 targets(배선 소비처)를 형태 보장한 뒤 레거시 단일 account 필드를 "첫 계좌 미러"로 덮는다.
// (deepMerge는 accounts 배열을 통째 교체하므로 여기서 형태·미러를 보장 → 미이전 소비처가 account만 읽어도
// 안전.) normalizeHolidays/normalizeSubjects와 같은 "읽기 시 승격" 패턴. 소비처는 accountForTarget로 읽는다.
const ACCOUNT_TARGET_SET = new Set<string>(["textbook", "quote"]);
function normalizeBilling(b: BillingSettings): BillingSettings {
  const raw = Array.isArray(b.accounts) ? b.accounts : [];
  let accounts: AccountSetting[] = raw.map((a) => ({
    label: typeof a?.label === "string" ? a.label : "",
    bank: a?.bank ?? "",
    holder: a?.holder ?? "",
    number: a?.number ?? "",
    // 알 수 없는 target 키는 걸러낸다(스키마 변경 시 유령 키 방어).
    targets: (Array.isArray(a?.targets) ? a.targets : []).filter(
      (t): t is AccountSetting["targets"][number] => typeof t === "string" && ACCOUNT_TARGET_SET.has(t),
    ),
  }));
  // 목록이 비었는데 옛 단일 account에 값이 있으면 승격(targets 미지정 → 소비처는 첫 계좌로 폴백).
  if (accounts.length === 0) {
    const a = b.account;
    if (a && (a.bank || a.holder || a.number)) {
      accounts = [{ label: a.label ?? "", bank: a.bank, holder: a.holder, number: a.number, targets: [] }];
    }
  }
  const mirror = accounts[0] ?? b.account; // 하위호환 미러(첫 계좌)
  return { ...b, accounts, account: mirror };
}

/** 저장값(부분) + 테넌트 메타 → 완전한 설정. name 미입력 시 테넌트 학원명으로 폴백. */
export function resolveSettings(stored: unknown, tenant: { name: string }): TenantSettings {
  const preset = presetOfStored(stored);
  const base = baseSettingsFor(preset);
  const storedPermissions = isPlainObject(stored) && isPlainObject(stored.permissions) ? stored.permissions : undefined;
  // 기본값 병합 전에 원문의 속성 존재 여부로 결정한다. 명시 []·null은 레거시 누락과 다르다.
  const managerIds = effectivePayslipManagerIds(storedPermissions?.specialAccess);
  const merged = deepMerge(base, stored);
  const storedOperations = isPlainObject(stored) && isPlainObject(stored.operations) ? stored.operations : undefined;
  return {
    ...merged,
    // 프리셋은 저장값이 아니라 판정 결과다 — 행에 preset이 없어도(침산) 판정값을 싣는다.
    preset,
    permissions: {
      ...merged.permissions,
      specialAccess: {
        ...merged.permissions.specialAccess,
        payslipManagerIds: managerIds,
        studentStatusManagerIds: studentStatusManagerIds(storedPermissions?.specialAccess),
      },
    },
    profile: { ...merged.profile, name: merged.profile.name || tenant.name },
    operations: {
      ...merged.operations,
      subjects: normalizeSubjects(merged.operations.subjects, base),
      holidays: normalizeHolidays(merged.operations.holidays),
      jobTitlesByDepartment: mergeDepartmentTitles(
        base.operations.jobTitlesByDepartment,
        storedOperations?.jobTitlesByDepartment,
      ),
    },
    billing: normalizeBilling(merged.billing),
    navigation: normalizeNavigationSettings(merged.navigation),
    // 일반판의 옛 저장 행은 그때 없던 새 모듈을 자동으로 켜지 않는다. 침산은 known을 보지 않아 종전과 같다.
    modules: {
      disabled: effectiveDisabledModulesFromStored(stored) as ModuleId[],
      known: knownModulesFromStored(stored) as ModuleId[],
    },
    makeups: normalizeMakeupSettings(merged.makeups),
    // 운영실 배치 — 판 번호가 다르거나 깨진 역할 배치는 버려 기본 배치로 돌아가고, 모르는 카드·이탈 좌표는 걸러 낸다.
    dashboard: normalizeDashboard(merged.dashboard),
  };
}
