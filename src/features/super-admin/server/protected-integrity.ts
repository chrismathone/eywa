import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportError, reportWarning } from "@/lib/observability/report-error";
import {
  judgeProtectedIntegrity,
  type IntegrityAuth,
  type IntegrityIssue,
  type IntegrityUserRow,
  type TriggerState,
} from "@/lib/auth/protected-integrity-core";

/** 크론이 남기는 총괄 감사로그의 행위자(사람이 아니다 — actor_id가 not null이라 nil uuid로 적는다). */
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";
const SYSTEM_ACTOR_EMAIL = "system:daily-integrity-check";

export type ProtectedIntegrityResult = { members: number; issues: IntegrityIssue[]; triggersChecked: boolean };

/**
 * 보호 계정 매일 점검(3선, 원장 2026-09-30) — 판정은 `judgeProtectedIntegrity`(순수), 여기는 조회·알림만.
 * 이상이 있으면 ① `reportError`(Vercel 로그 `scope=security.protected-integrity`) ② **총괄 감사로그**
 * (`super_admin_audit_logs` — 지점 감사로그에 적지 않는 이유: 지점 화면에선 총괄이 '관리자'로 위장한다).
 * 🔴 읽기만 한다 — 어긋남을 **고치지 않는다**(되돌리는 것도 원장 승인 사항이다).
 */
export async function checkProtectedAccountIntegrity(admin: SupabaseClient): Promise<ProtectedIntegrityResult> {
  const { data: memberRows, error: memberErr } = await admin.from("super_admins").select("id");
  if (memberErr) throw memberErr;
  const members = (memberRows ?? []).map((r) => String(r.id));

  const [usersRes, authRows, triggerRes] = await Promise.all([
    members.length
      ? admin.from("users").select("id, system_role, status, tenant_id").in("id", members)
      : Promise.resolve({ data: [], error: null }),
    Promise.all(members.map((id) => loadAuth(admin, id))),
    admin.rpc("protected_guard_triggers"),
  ]);
  if (usersRes.error) throw usersRes.error;

  let triggers: TriggerState[] | null = null;
  if (triggerRes.error) {
    // 0312a 미적용이면 함수가 없다 — 데이터 점검은 그대로 하고 트리거 확인만 빠졌다고 남긴다.
    reportWarning("보호 계정 가드 트리거 확인 불가(0312a 미적용?)", {
      scope: "security.protected-integrity.triggers",
      code: triggerRes.error.code,
    });
  } else {
    triggers = (triggerRes.data ?? []) as TriggerState[];
  }

  const issues = judgeProtectedIntegrity({
    members,
    users: (usersRes.data ?? []) as IntegrityUserRow[],
    auth: authRows,
    triggers,
    now: new Date(),
  });

  if (issues.length > 0) {
    reportError(new Error(`보호 계정 무결성 이상 ${issues.length}건`), {
      scope: "security.protected-integrity",
      issues,
    });
    const { error: logErr } = await admin.from("super_admin_audit_logs").insert({
      actor_id: SYSTEM_ACTOR_ID,
      actor_email: SYSTEM_ACTOR_EMAIL,
      action: "protected_integrity_alert",
      target_tenant_id: null,
      target_label: `보호 계정 점검 이상 ${issues.length}건`,
      metadata: { issues },
    });
    if (logErr) reportError(logErr, { scope: "security.protected-integrity.audit" });
  }
  return { members: members.length, issues, triggersChecked: triggers !== null };
}

async function loadAuth(admin: SupabaseClient, id: string): Promise<IntegrityAuth> {
  const { data, error } = await admin.auth.admin.getUserById(id);
  if (error) {
    // 404 = 로그인 계정이 없다(그 자체가 이상). 그 밖의 실패는 "모름"이라 점검을 멈춘다(거짓 '정상'을 내지 않는다).
    if (error.status === 404 || /not found/i.test(error.message)) {
      return { id, found: false, appRole: null, appTenant: null, bannedUntil: null, deletedAt: null };
    }
    throw error;
  }
  const u = data.user;
  const meta = (u.app_metadata ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    id,
    found: true,
    appRole: str(meta.system_role),
    appTenant: str(meta.tenant_id),
    bannedUntil: str(u.banned_until),
    deletedAt: str(u.deleted_at),
  };
}
