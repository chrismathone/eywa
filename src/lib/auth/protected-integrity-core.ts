/**
 * 보호 계정(super_admins 명단) **매일 점검**의 순수 판정 — 세 번째 선(원장 2026-09-30 *"2,3중이상으로 해도 되니까"*).
 *
 * 1선 = 앱 가드(`protected-accounts.ts`) · 2선 = DB 트리거(0309a·0312a) · **3선 = 이 점검**.
 * 앞의 두 선은 "막는" 선이라 **꺼지거나 우회되면 조용하다**(테이블 소유자의 `disable trigger`, 우회 스위치를 켠 채
 * 실수, 트리거 삭제). 이 점검은 결과(명단·역할·상태·로그인 차단)를 매일 보고 어긋나면 크게 알린다.
 *
 * 🔴 기준 명단(BASELINE)은 **감지 전용**이다 — 보호 자체는 여전히 "명단에 있으면 보호"(이름·id를 코드로 막지 않는다).
 *    명단이 원장 승인으로 바뀌면 이 목록도 같이 고친다(안 고치면 매일 알림이 떠서 잊을 수 없다 — 그게 의도).
 */

/** 2026-09-30 기준 명단(super_admins). 순서 무관. */
export const BASELINE_PROTECTED_IDS: readonly string[] = [
  "fcf735fa-edf7-4095-8fa6-724285a018ed",
  "477950d4-9cb0-4c02-9ac4-f00d42754d55",
  "53962073-55de-4cb2-aa7a-2bda31ba53bc", // 로그인 전용(직원 행 없음)
];

/** 0309a가 붙인 가드 트리거 5개. */
export const EXPECTED_GUARD_TRIGGERS: readonly string[] = [
  "tg_guard_protected_users",
  "tg_guard_users_truncate",
  "tg_guard_protected_auth_users",
  "tg_guard_super_admins",
  "tg_guard_super_admins_truncate",
];

export type IntegrityUserRow = { id: string; system_role: string | null; status: string | null; tenant_id: string | null };
export type IntegrityAuth = {
  id: string;
  found: boolean;
  appRole: string | null;
  appTenant: string | null;
  bannedUntil: string | null;
  deletedAt: string | null;
};
export type TriggerState = { trigger_name: string; enabled: string };

export type IntegrityCode =
  | "member_removed"
  | "member_added"
  | "auth_missing"
  | "auth_deleted"
  | "auth_banned"
  | "users_row_missing"
  | "role_changed"
  | "status_changed"
  | "app_role_changed"
  | "tenant_mismatch"
  | "trigger_missing"
  | "trigger_disabled";
export type IntegrityIssue = { id: string | null; code: IntegrityCode; detail: string };

export function judgeProtectedIntegrity(input: {
  members: readonly string[];
  users: readonly IntegrityUserRow[];
  auth: readonly IntegrityAuth[];
  /** null = 트리거 조회 불가(0312a 미적용 등) — 판정에서 뺀다(호출부가 경고). */
  triggers: readonly TriggerState[] | null;
  now: Date;
  baseline?: readonly string[];
}): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const baseline = input.baseline ?? BASELINE_PROTECTED_IDS;
  const members = new Set(input.members);
  for (const id of baseline) {
    if (!members.has(id)) issues.push({ id, code: "member_removed", detail: "보호 명단에서 빠졌다" });
  }
  for (const id of members) {
    if (!baseline.includes(id)) issues.push({ id, code: "member_added", detail: "기준에 없는 계정이 명단에 추가됐다" });
  }

  const userById = new Map(input.users.map((u) => [u.id, u]));
  const authById = new Map(input.auth.map((a) => [a.id, a]));
  for (const id of members) {
    const a = authById.get(id);
    const u = userById.get(id);
    if (!a || !a.found) {
      issues.push({ id, code: "auth_missing", detail: "로그인 계정이 없다" });
    } else {
      if (a.deletedAt) issues.push({ id, code: "auth_deleted", detail: `로그인 계정이 삭제 표시됨(${a.deletedAt})` });
      if (a.bannedUntil && new Date(a.bannedUntil).getTime() > input.now.getTime()) {
        issues.push({ id, code: "auth_banned", detail: `로그인 차단(${a.bannedUntil}까지)` });
      }
    }
    if (!u) {
      // 로그인 전용 계정(직원 행 없음)은 정상 — 단 로그인 계정에 역할이 적혀 있으면 원래 직원이었다(행이 지워졌다).
      if (a?.found && a.appRole) issues.push({ id, code: "users_row_missing", detail: "직원 행이 없다(로그인 계정엔 역할이 있음)" });
      continue;
    }
    if (u.system_role !== "master") issues.push({ id, code: "role_changed", detail: `역할 ${u.system_role ?? "없음"}` });
    if (u.status !== "active") issues.push({ id, code: "status_changed", detail: `재직 상태 ${u.status ?? "없음"}` });
    if (a?.found) {
      if (a.appRole !== "master") issues.push({ id, code: "app_role_changed", detail: `로그인 계정 역할 ${a.appRole ?? "없음"}` });
      if (a.appTenant !== u.tenant_id) issues.push({ id, code: "tenant_mismatch", detail: "로그인 계정과 직원 행의 지점이 다르다" });
    }
  }

  if (input.triggers) {
    const byName = new Map(input.triggers.map((t) => [t.trigger_name, t.enabled]));
    for (const name of EXPECTED_GUARD_TRIGGERS) {
      const enabled = byName.get(name);
      if (enabled === undefined) issues.push({ id: null, code: "trigger_missing", detail: `가드 트리거 없음: ${name}` });
      else if (enabled !== "O" && enabled !== "A") {
        issues.push({ id: null, code: "trigger_disabled", detail: `가드 트리거 꺼짐: ${name}(${enabled})` });
      }
    }
  }
  return issues;
}
