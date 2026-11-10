/**
 * 퇴사자를 학원 설정의 **사람 지정 칸**에서 빼는 규칙 — 순수 함수(Vitest · 서버·화면 공용, `server-only` 없음 [[#61]]).
 *
 * 원장 2026-11-09 *"엄소윤 직원을 오늘자로 퇴사시켰는데도 여전히 권한에 배정된게 남아있네. 퇴사시 같이 사라지게"*.
 * 🔴 **원칙(팀장 2026-11-10 · 리뷰 r1 F1): 퇴사 정리는 권한을 '주는' 값만 지우고, '좁히는' 값은 남긴다.**
 *    지시의 뜻은 퇴사자가 가진 권한을 없애는 것이지 제한을 지우는 것이 아니다 — 좁히는 값을 지우면 그 사람을 다시 재직으로 돌렸을 때
 *    권한이 넓어진다(직원관리 쓰기 권한자가 퇴사 → 재직 두 번으로 원장이 걸어 둔 제한을 풀 수 있었다).
 * 학원 설정에서 사람을 고르는 칸(전수 — `PERSON_FIELDS`):
 *  · **주는 값(지운다)** — 개인별 기능 권한의 사람 칸 12개(`SPECIAL_ACCESS_ID_LISTS` — 명단에 있으면 그 기능이 열린다)
 *    · 개인별 메뉴 권한(`userOverrides`) 중 **그 사람 역할 값보다 더 주는 줄**(판정 `userOverrideGrants` 하나).
 *  · **좁히는 값(남긴다)** — 개인별 메뉴 권한 중 역할 값보다 낮은 줄 · 직원관리 과목 범위(`staffSubjectScopes` — 없으면 전 과목) ·
 *    대시보드 직원별 배정(`dashboard.assignments` — 없으면 역할 기본 범위). 화면은 이름 뒤에 '(퇴사)'만 붙여 보인다(숨기면 면을 저장할 때 제한이 조용히 사라진다).
 * 쓰는 곳 두 갈래(같은 판정):
 *  ① 퇴사(또는 다시 재직으로 돌릴 때 · 완전 삭제) — 저장값에서 주는 값만 뺀다(`removePersonFromStored` · 서버 `retired-people.ts`).
 *  ② 읽을 때 — 이미 남아 있는 퇴사자의 주는 값을 판정·후보·화면 초기값에서 거른다(`withoutRetiredPeople` — `getTenantSettings` · 역할·권한 면).
 * 🔴 퇴원보고서 승인자(`withdrawalApproverIds`)는 **명단을 비우지 않는다** — 빈 명단은 '지정 없음 = 그 과목 관리자 전원'이라
 *    지정자가 모두 퇴사한 학원의 승인 후보가 넓어진다. 지정자가 모두 퇴사했으면 남겨 두어 작성 요청을 막는다(편집기 안내문 ·
 *    리뷰 2026-11-06 '지정자가 모두 퇴사했으면 요청할 수 없다'와 같은 결 — `narrowApprovalSubjects`는 재직자만 후보로 본다).
 *    ⚠️ 그래서 그 한 명은 다시 재직으로 돌리면 승인자로 돌아온다(원장이 새 승인자를 지정하면 빠진다).
 * 🔴 칸을 더하면(새 사람 칸) `PERSON_FIELDS`와 아래 함수에 함께 넣고 **주는 값인지 좁히는 값인지** 정할 것 — 가드 `retired-people.test.ts`가 스키마의 사람 칸 목록과 맞춘다.
 */
import { MENU_KEYS, resolveMatrix, SYSTEM_ROLES, isPermissionLocked, storedScopedAccess, type Access, type AccessMatrix, type MenuKey, type PermissionOverride, type SystemRole } from "@/lib/permissions";
import { SPECIAL_ACCESS_ID_LISTS, type TenantSettings } from "./settings-types";

export type SpecialAccessIdList = (typeof SPECIAL_ACCESS_ID_LISTS)[number];

/** 퇴사가 **확인된** 사람 → 그 사람 역할(모르면 null). 재직 상태가 퇴사로 확인되지 않은 사람(계정이 없는 사람 포함)은 넣지 않는다(리뷰 r1 F3). */
export type RetiredPeople = ReadonlyMap<string, SystemRole | null>;

/** 개인별 기능 권한 칸의 화면 이름 — 권한 화면·변경 내역·감사로그가 같은 말을 쓴다. */
export const SPECIAL_ACCESS_LABEL: Record<SpecialAccessIdList, string> = {
  payslipViewerIds: "급여명세서 열람",
  payslipManagerIds: "급여명세서 관리",
  leaveAdjusterIds: "연차 조정",
  classSplitterIds: "수업 나누기",
  enrollmentDateEditorIds: "수강 날짜 수정",
  studentStatusManagerIds: "원생 상태 변경",
  staffTaskMonitorIds: "업무 처리 현황",
  vendorViewerIds: "업체리스트",
  jjReportManagerIds: "JJ 보고서 담당",
  beforeClassReportIds: "비포클래스 보고서 표",
  withdrawalApproverIds: "퇴원보고서 승인자",
  withdrawalDeskIds: "데스크 담당자",
};

/** 사람을 고르는 칸 전부 — `grants` = 권한을 주는 값(퇴사 정리가 지운다) · 아니면 좁히는 값(남긴다). 감사로그·드라이런의 칸 이름. */
export const PERSON_FIELDS = [
  ...SPECIAL_ACCESS_ID_LISTS.map((key) => ({ key, label: SPECIAL_ACCESS_LABEL[key], grants: true })),
  { key: "userOverrides", label: "개인별 메뉴 권한", grants: true },
  { key: "staffSubjectScopes", label: "직원관리 과목 범위", grants: false },
  { key: "dashboardAssignments", label: "대시보드 직원별 배정", grants: false },
] as const;
export type PersonFieldKey = (typeof PERSON_FIELDS)[number]["key"];
export const PERSON_FIELD_LABEL = Object.fromEntries(PERSON_FIELDS.map((f) => [f.key, f.label])) as Record<PersonFieldKey, string>;

/** 비우면 뜻이 넓어지는 칸 — 지정자가 모두 빠질 때는 남겨 둔다(위 머리말 🔴). */
export const KEEP_WHEN_LAST: ReadonlySet<SpecialAccessIdList> = new Set(["withdrawalApproverIds"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const rowUser = (row: unknown) => (isRecord(row) && typeof row.userId === "string" ? row.userId : null);
const ACCESSES: readonly Access[] = ["full", "scoped", "readonly", "none"];
const isMenuKey = (v: unknown): v is MenuKey => typeof v === "string" && (MENU_KEYS as readonly string[]).includes(v);
const isAccess = (v: unknown): v is Access => typeof v === "string" && (ACCESSES as readonly string[]).includes(v);

/** 저장값의 역할 칸 줄(손으로 넣은 깨진 줄은 건너뛴다) → 역할 표. 개인 줄이 '더 주는가'를 견줄 기준이다. */
export function roleMatrixOfStored(overrides: unknown): AccessMatrix {
  const rows: PermissionOverride[] = [];
  for (const r of Array.isArray(overrides) ? overrides : []) {
    if (isRecord(r) && isMenuKey(r.menu) && isAccess(r.access) && typeof r.role === "string" && (SYSTEM_ROLES as readonly string[]).includes(r.role)) {
      rows.push({ menu: r.menu, role: r.role as SystemRole, access: r.access });
    }
  }
  return resolveMatrix(rows);
}

/**
 * 개인별 메뉴 권한 한 줄이 그 사람에게 **역할보다 더 주는가** — 퇴사 정리·읽을 때 거르기·역할·권한 면 초기값이 함께 쓰는 판정 하나(리뷰 r1 F1).
 * 기준 = 그 사람 역할의 그 메뉴 칸(학원 설정의 역할 칸 반영 — `roleMatrix`). 적용 규칙은 `applyUserOverrides`와 같다(금지 '담당'은 내려 견주고 · 잠긴 줄은 적용되지 않는다).
 *  · 더 주는 줄 = 전체(그보다 넓은 값은 없다)이거나, 역할 칸이 '없음'인데 무언가를 연 줄.
 *  · 같은 값 · 역할보다 낮은 줄(좁히는 줄) · 견줄 수 없는 줄(읽기 ↔ 담당 — 전체 읽기와 담당 쓰기는 서로를 포함하지 않는다) · 역할을 모름 · 적용되지 않는 줄
 *    → false(남긴다 — 닫힌 쪽).
 */
export function userOverrideGrants(row: { menu: MenuKey; access: Access }, role: SystemRole | null | undefined, roleMatrix: AccessMatrix): boolean {
  if (!role || !isMenuKey(row.menu) || !isAccess(row.access)) return false;
  const base = roleMatrix[row.menu]?.[role];
  if (!base) return false;
  const access = storedScopedAccess(row.menu, role, row.access, base);
  if (isPermissionLocked(row.menu, role, access)) return false;
  if (access === base || access === "none") return false;
  return access === "full" || base === "none";
}

/** 저장값에 오른 사람 id 전부(중복 없이) — 퇴사자 조회의 대상. */
export function storedPersonIds(data: unknown): string[] {
  const root = isRecord(data) ? data : {};
  const permissions = isRecord(root.permissions) ? root.permissions : {};
  const special = isRecord(permissions.specialAccess) ? permissions.specialAccess : {};
  const dashboard = isRecord(root.dashboard) ? root.dashboard : {};
  const ids = (list: unknown) => (Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : []);
  const rows = (list: unknown) => (Array.isArray(list) ? list.flatMap((row) => rowUser(row) ?? []) : []);
  return [...new Set([
    ...SPECIAL_ACCESS_ID_LISTS.flatMap((key) => ids(special[key])),
    ...rows(special.staffSubjectScopes),
    ...rows(permissions.userOverrides),
    ...rows(dashboard.assignments),
  ])];
}

/**
 * 저장값(`tenant_settings.data` 원본 jsonb)에서 한 사람의 **주는 값만** 뺀다 — 그 사람이 있는 칸만 바꾸고, 다른 칸·다른 섹션·이 코드가 모르는 키는 그대로 둔다(#142).
 * 좁히는 값(역할보다 낮은 개인 메뉴 줄 · 직원관리 과목 범위 · 대시보드 배정)은 남긴다(머리말 원칙). `role` = 그 사람의 역할(모르면 null — 개인 메뉴 줄은 남긴다).
 * 없는 칸을 새로 만들지 않는다(`payslipManagerIds` · `studentStatusManagerIds`는 **없음 자체가 뜻**이다 — 옛 방식 · 열람자와 같음).
 * `removed` = 그 사람이 빠진 칸(감사로그 · 바뀐 것이 없으면 빈 목록 — 쓰지 않는다). `kept` = 마지막 한 명이라 남긴 칸.
 */
export function removePersonFromStored(data: unknown, userId: string, role: SystemRole | null): { data: unknown; removed: PersonFieldKey[]; kept: PersonFieldKey[] } {
  if (!isRecord(data)) return { data, removed: [], kept: [] };
  const removed: PersonFieldKey[] = [];
  const kept: PersonFieldKey[] = [];
  const permissions = isRecord(data.permissions) ? data.permissions : null;
  if (!permissions) return { data, removed, kept };
  const nextPermissions: Record<string, unknown> = { ...permissions };
  const special = isRecord(permissions.specialAccess) ? permissions.specialAccess : null;
  if (special) {
    const nextSpecial: Record<string, unknown> = { ...special };
    for (const key of SPECIAL_ACCESS_ID_LISTS) {
      const list = special[key];
      if (!Array.isArray(list) || !list.includes(userId)) continue;
      const rest = list.filter((id) => id !== userId);
      if (rest.length === 0 && KEEP_WHEN_LAST.has(key)) {
        kept.push(key);
        continue;
      }
      nextSpecial[key] = rest;
      removed.push(key);
    }
    nextPermissions.specialAccess = nextSpecial;
  }
  if (Array.isArray(permissions.userOverrides)) {
    const roleMatrix = roleMatrixOfStored(permissions.overrides);
    const grantsRow = (row: unknown) =>
      rowUser(row) === userId && isRecord(row) && userOverrideGrants({ menu: row.menu as MenuKey, access: row.access as Access }, role, roleMatrix);
    if (permissions.userOverrides.some(grantsRow)) {
      nextPermissions.userOverrides = permissions.userOverrides.filter((row) => !grantsRow(row));
      removed.push("userOverrides");
    }
  }
  if (removed.length === 0) return { data, removed, kept };
  return { data: { ...data, permissions: nextPermissions }, removed, kept };
}

/**
 * 읽은 설정(해석 뒤)에서 퇴사자의 **주는 값**을 거른다 — 개인별 기능 권한의 사람 칸 · 역할보다 더 주는 개인별 메뉴 권한 줄(판정·후보·화면 초기값이 여기를 본다).
 * 좁히는 값(역할보다 낮은 개인 줄 · 직원관리 과목 범위)은 거르지 않는다 — 걸러서 숨기면 역할·권한 면을 저장할 때 제한이 조용히 사라진다.
 * 퇴원보고서 승인자는 모두 퇴사자면 그대로 둔다(머리말 🔴 — 비우면 '지정 없음'으로 넓어진다). `undefined`인 칸은 `undefined`로 둔다(없음이 뜻인 칸 — 옛 방식).
 */
export function withoutRetiredPeople<T extends Pick<TenantSettings, "permissions">>(settings: T, retired: RetiredPeople): T {
  if (retired.size === 0) return settings;
  const special = settings.permissions.specialAccess;
  const next = { ...special } as Record<string, unknown>;
  let specialChanged = false;
  for (const key of SPECIAL_ACCESS_ID_LISTS) {
    const list = special[key];
    if (!Array.isArray(list) || !list.some((id) => retired.has(id))) continue;
    const rest = list.filter((id) => !retired.has(id));
    if (rest.length === 0 && KEEP_WHEN_LAST.has(key)) continue;
    next[key] = rest;
    specialChanged = true;
  }
  const overrides = settings.permissions.userOverrides;
  let userOverrides = overrides;
  if (overrides.some((row) => retired.has(row.userId))) {
    const roleMatrix = resolveMatrix(settings.permissions.overrides);
    const grantsRow = (row: (typeof overrides)[number]) => retired.has(row.userId) && userOverrideGrants(row, retired.get(row.userId), roleMatrix);
    if (overrides.some(grantsRow)) userOverrides = overrides.filter((row) => !grantsRow(row));
  }
  if (!specialChanged && userOverrides === overrides) return settings;
  return {
    ...settings,
    permissions: { ...settings.permissions, userOverrides, ...(specialChanged ? { specialAccess: next as typeof special } : {}) },
  };
}
