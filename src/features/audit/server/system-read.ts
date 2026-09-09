import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * 감사로그를 **기능이 읽는** 좁은 문 — 사람이 보는 감사로그 뷰어와 다른 축이다.
 *
 * 원장 2026-09-09: *"감사로그는 마스터 이상급으로만."* 그전까지 `audit_logs`의 select 정책은
 * **테넌트 격리뿐**이라, 화면은 `/owner`로 막혀 있어도 로그인한 강사·뷰어가 PostgREST로 전 로그를
 * 읽을 수 있었다(화면에서만 잠근 전형, [[#77]]). 이제 정책을 master·super_admin으로 좁히는데 —
 * 그러면 **강사도 쓰는 화면 셋**이 함께 죽는다:
 *   ① 지난 주 담임 복원(`teacher-as-of`) ② 반 이력 ③ 병합된 상담 따라가기.
 * 셋 다 감사로그를 "이력 저장소"로 쓸 뿐 감사 목적이 아니라, 여기 **좁은 문**을 하나 내고 그리로만 보낸다.
 *
 * 🔴 **admin은 RLS를 우회한다** — 그래서 이 문이 `tenant_id`를 **직접** 건다(빠뜨리면 전 학원이 샌다).
 * 🔴 **action 허용 목록이 이 문의 자물쇠다.** 아무 action이나 읽게 열면 정책을 좁힌 의미가 없어진다 —
 *    급여·지출·환불 로그가 이 문으로 도로 새 나간다. 새 화면이 다른 action을 원하면 **여기 목록에
 *    추가하면서** 그게 강사에게 보여도 되는 사실인지 그 자리에서 판단할 것.
 * 🔴 세션이 없으면(cron·PIN 화면) **null**이다 — 테넌트를 모르는 채로 admin을 쓰면 남의 학원을 읽는다.
 */

/**
 * 이 문으로 읽을 수 있는 action — **민감하지 않은 이력만**.
 * 담임 인계·반 정보 수정·상담 병합은 그 반/그 상담을 보는 사람이면 이미 아는 사실이다.
 * 🔴 여기에 급여·지출·환불·명세서·출결 계열을 넣지 말 것(그게 이 자물쇠의 존재 이유다).
 */
export const SYSTEM_READABLE_AUDIT_ACTIONS = [
  "class_handover_apply",
  "class_handover_schedule",
  "class_handover_cancel",
  "class_handover_bulk",
  "class_update",
  "class_delegate",
  "class_delegate_revoke",
  "class_archive",
  "class_unarchive",
  "class_end_term",
  "class_reopen_term",
  "class_schedule_move",
  "classroom_auto_assign",
  "consultation_merge",
] as const;

export type SystemReadableAuditAction = (typeof SYSTEM_READABLE_AUDIT_ACTIONS)[number];

/** 이 요청의 테넌트 — 세션이 없으면 null(그때는 아무것도 읽지 않는다). */
export async function auditReadTenant(): Promise<string | null> {
  const user = await getCurrentUser();
  return user?.tenantId ?? null;
}

/**
 * 이 요청이 감사로그를 읽을 수 있는 범위 — admin 클라이언트 + 테넌트 + 허용 action.
 * 세션이 없거나 허용 action이 하나도 없으면 **null**이고, 그때 호출부는 빈 결과로 간다.
 */
export type AuditScope = {
  admin: ReturnType<typeof createAdminClient>;
  tenantId: string;
  actions: string[];
};

export async function systemAuditScope(
  actions: readonly SystemReadableAuditAction[],
): Promise<AuditScope | null> {
  const tenantId = await auditReadTenant();
  if (!tenantId) return null;
  // 목록 밖 값은 조용히 빠진다(타입이 1차 방어, 이 필터가 2차).
  const allowed = actions.filter((a) => (SYSTEM_READABLE_AUDIT_ACTIONS as readonly string[]).includes(a));
  if (allowed.length === 0) return null;
  return { admin: createAdminClient(), tenantId, actions: [...allowed] };
}

/**
 * 범위를 조회에 씌운다 — 🔴 **`tenant_id`와 `action`은 여기서만** 건다(호출부에 맡기면 언젠가 빠뜨리고,
 * admin은 RLS를 우회하므로 그 한 번이 곧 전 학원 유출이다).
 *
 * 쓰는 법:
 * ```ts
 * const scope = await systemAuditScope(["class_update"]);
 * if (!scope) return [];
 * const { data } = await auditScoped(scope.admin.from("audit_logs").select("metadata, created_at"), scope)
 *   .gte("created_at", since)
 *   .order("created_at");
 * ```
 */
export function auditScoped<Q>(q: Q, scope: AuditScope): Q {
  // ⚠️ 제네릭을 supabase 빌더 타입으로 **제약하지 않는다** — 그 타입이 재귀적이라 제약을 걸면
  //    타입 인스턴스화가 너무 깊어져 컴파일이 터진다(TS2589). 여기서 필요한 건 두 메서드뿐이다.
  type Chain = { eq: (c: string, v: string) => Chain; in: (c: string, v: string[]) => Chain };
  return (q as Chain).eq("tenant_id", scope.tenantId).in("action", scope.actions) as unknown as Q;
}
