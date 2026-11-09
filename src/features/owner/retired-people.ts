/**
 * 퇴사자를 학원 설정의 **사람 지정 칸**에서 빼는 규칙 — 순수 함수(Vitest · 서버·화면 공용, `server-only` 없음 [[#61]]).
 *
 * 원장 2026-11-09 *"엄소윤 직원을 오늘자로 퇴사시켰는데도 여전히 권한에 배정된게 남아있네. 퇴사시 같이 사라지게"*.
 * 학원 설정에서 사람을 고르는 칸(전수 — `PERSON_FIELDS`):
 *  · 역할·권한 → 개인별 기능 권한(`permissions.specialAccess`)의 사람 칸 12개(`SPECIAL_ACCESS_ID_LISTS`) + 직원관리 과목 범위(`staffSubjectScopes[].userId`)
 *  · 역할·권한 → 개인별 메뉴 권한(`permissions.userOverrides[].userId` — 전자결재·직원 평가 등 사람에게 연 메뉴)
 *  · 대시보드 관리 → 직원별 배정(`dashboard.assignments[].userId`)
 * 쓰는 곳 두 갈래:
 *  ① 퇴사(또는 다시 재직으로 돌릴 때 · 완전 삭제) — 저장값에서 그 사람을 뺀다(`removePersonFromStored` · 서버 `retired-people.ts`).
 *  ② 읽을 때 — 이미 남아 있는 퇴사자를 판정·후보·화면에서 거른다(`withoutRetiredPeople` — `getTenantSettings` 등).
 * 🔴 퇴원보고서 승인자(`withdrawalApproverIds`)는 **명단을 비우지 않는다** — 빈 명단은 '지정 없음 = 그 과목 관리자 전원'이라
 *    지정자가 모두 퇴사한 학원의 승인 후보가 넓어진다. 지정자가 모두 퇴사했으면 남겨 두어 작성 요청을 막는다(편집기 안내문 ·
 *    리뷰 2026-11-06 '지정자가 모두 퇴사했으면 요청할 수 없다'와 같은 결 — `narrowApprovalSubjects`는 재직자만 후보로 본다).
 * 🔴 칸을 더하면(새 사람 칸) `PERSON_FIELDS`와 아래 두 함수에 함께 넣을 것 — 가드 `retired-people.test.ts`가 스키마의 사람 칸 목록과 맞춘다.
 */
import { SPECIAL_ACCESS_ID_LISTS, type TenantSettings } from "./settings-types";

export type SpecialAccessIdList = (typeof SPECIAL_ACCESS_ID_LISTS)[number];

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

/** 사람을 고르는 칸 전부(감사로그·드라이런의 칸 이름). */
export const PERSON_FIELDS = [
  ...SPECIAL_ACCESS_ID_LISTS.map((key) => ({ key, label: SPECIAL_ACCESS_LABEL[key] })),
  { key: "staffSubjectScopes", label: "직원관리 과목 범위" },
  { key: "userOverrides", label: "개인별 메뉴 권한" },
  { key: "dashboardAssignments", label: "대시보드 직원별 배정" },
] as const;
export type PersonFieldKey = (typeof PERSON_FIELDS)[number]["key"];
export const PERSON_FIELD_LABEL = Object.fromEntries(PERSON_FIELDS.map((f) => [f.key, f.label])) as Record<PersonFieldKey, string>;

/** 비우면 뜻이 넓어지는 칸 — 지정자가 모두 빠질 때는 남겨 둔다(위 머리말 🔴). */
export const KEEP_WHEN_LAST: ReadonlySet<SpecialAccessIdList> = new Set(["withdrawalApproverIds"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const rowUser = (row: unknown) => (isRecord(row) && typeof row.userId === "string" ? row.userId : null);

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
 * 저장값(`tenant_settings.data` 원본 jsonb)에서 한 사람을 뺀다 — 그 사람이 있는 칸만 바꾸고, 다른 칸·다른 섹션·이 코드가 모르는 키는 그대로 둔다(#142).
 * 없는 칸을 새로 만들지 않는다(`payslipManagerIds` · `studentStatusManagerIds`는 **없음 자체가 뜻**이다 — 옛 방식 · 열람자와 같음).
 * `removed` = 그 사람이 빠진 칸(감사로그 · 바뀐 것이 없으면 빈 목록 — 쓰지 않는다). `kept` = 마지막 한 명이라 남긴 칸.
 */
export function removePersonFromStored(data: unknown, userId: string): { data: unknown; removed: PersonFieldKey[]; kept: PersonFieldKey[] } {
  if (!isRecord(data)) return { data, removed: [], kept: [] };
  const removed: PersonFieldKey[] = [];
  const kept: PersonFieldKey[] = [];
  let permissions = isRecord(data.permissions) ? data.permissions : null;
  if (permissions) {
    let special = isRecord(permissions.specialAccess) ? permissions.specialAccess : null;
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
      if (Array.isArray(special.staffSubjectScopes) && special.staffSubjectScopes.some((row) => rowUser(row) === userId)) {
        nextSpecial.staffSubjectScopes = special.staffSubjectScopes.filter((row) => rowUser(row) !== userId);
        removed.push("staffSubjectScopes");
      }
      special = nextSpecial;
    }
    const nextPermissions: Record<string, unknown> = { ...permissions, ...(special ? { specialAccess: special } : {}) };
    if (Array.isArray(permissions.userOverrides) && permissions.userOverrides.some((row) => rowUser(row) === userId)) {
      nextPermissions.userOverrides = permissions.userOverrides.filter((row) => rowUser(row) !== userId);
      removed.push("userOverrides");
    }
    permissions = nextPermissions;
  }
  let dashboard = isRecord(data.dashboard) ? data.dashboard : null;
  if (dashboard && Array.isArray(dashboard.assignments) && dashboard.assignments.some((row) => rowUser(row) === userId)) {
    dashboard = { ...dashboard, assignments: dashboard.assignments.filter((row) => rowUser(row) !== userId) };
    removed.push("dashboardAssignments");
  }
  if (removed.length === 0) return { data, removed, kept };
  return {
    data: { ...data, ...(permissions ? { permissions } : {}), ...(dashboard ? { dashboard } : {}) },
    removed,
    kept,
  };
}

/**
 * 읽은 설정(해석 뒤)에서 퇴사자를 거른다 — **개인별 기능 권한**의 사람 칸 · 직원관리 과목 범위만(판정·후보·화면 칩이 여기를 본다).
 * 개인별 메뉴 권한(`userOverrides`)은 그 사람 자신의 메뉴만 바꾸고(퇴사자는 로그인이 막혀 있다) 화면이 '(퇴사)'로 보여 거둘 수 있어 그대로 둔다.
 * 퇴원보고서 승인자는 모두 퇴사자면 그대로 둔다(머리말 🔴 — 비우면 '지정 없음'으로 넓어진다).
 * `undefined`인 칸은 `undefined`로 둔다(없음이 뜻인 칸 — 옛 방식).
 */
export function withoutRetiredPeople<T extends Pick<TenantSettings, "permissions">>(settings: T, retired: ReadonlySet<string>): T {
  if (retired.size === 0) return settings;
  const special = settings.permissions.specialAccess;
  const next = { ...special } as Record<string, unknown>;
  let changed = false;
  for (const key of SPECIAL_ACCESS_ID_LISTS) {
    const list = special[key];
    if (!Array.isArray(list) || !list.some((id) => retired.has(id))) continue;
    const rest = list.filter((id) => !retired.has(id));
    if (rest.length === 0 && KEEP_WHEN_LAST.has(key)) continue;
    next[key] = rest;
    changed = true;
  }
  if (special.staffSubjectScopes.some((row) => retired.has(row.userId))) {
    next.staffSubjectScopes = special.staffSubjectScopes.filter((row) => !retired.has(row.userId));
    changed = true;
  }
  if (!changed) return settings;
  return { ...settings, permissions: { ...settings.permissions, specialAccess: next as typeof special } };
}
