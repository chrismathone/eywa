import "server-only";
/**
 * 퇴사자 권한 정리 — 서버 쪽(원장 2026-11-09 *"퇴사시 같이 사라지게"*). 규칙은 순수 모듈 [`retired-people.ts`](../retired-people.ts).
 *
 * ① 읽을 때 거르는 쪽(퇴사자 조회)은 가벼운 모듈 [`retired-lookup.ts`](./retired-lookup.ts) — 설정 읽기(`queries.ts`)가 쓴다.
 * ② `dropPersonFromSettings` — 퇴사·재입사·완전 삭제 때 그 사람의 **주는 값**을 저장값에서 뺀다(좁히는 값은 남긴다 — 원칙은 순수 모듈 머리말). 학원 설정 쓰기 규칙 그대로:
 *    방금 읽은 문서 위에 그 사람 줄만 빼고(통째 교체 금지 [[#142]]) · `updated_at` 비교로 그사이의 다른 저장을 덮지 않고(다르면 다시 읽어 3번까지) ·
 *    역할·권한 섹션 저장 순번(`permissions.rev`)을 올린다(열려 있는 역할·권한 면이 옛 값으로 저장하지 않게 — 그 면은 '다른 곳에서 바뀜'으로 거절된다).
 *    🔴 서버 키(service role)로 쓴다 — 퇴사 처리는 직원관리 권한자(원장이 아닐 수 있다)가 하는데, `tenant_settings` 쓰기 가드(0038a · 0335a)는
 *       원장 아닌 로그인 사용자의 쓰기를 거절한다([[#59]]). 쓰는 범위는 이 함수가 정한 칸(그 사람 줄)뿐이다.
 * 실패해도 퇴사 처리 자체는 되돌리지 않는다(이미 저장됨) — 읽는 쪽(`withoutRetiredPeople`)이 퇴사자의 주는 값을 거르므로 권한은 바로 닫힌다.
 * 실패는 서버 로그와 **감사로그**(직원관리 경로 · 운영 콘솔은 운영 감사)에 남긴다(리뷰 r1 F8).
 */
import { updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import type { SystemRole } from "@/lib/permissions";
import { removePersonFromStored, type PersonFieldKey } from "../retired-people";
import { nextSettingsStamp, settingsRevOf } from "../settings-stamp";
import { tenantSettingsTag } from "./queries";

type Db = ReturnType<typeof createAdminClient>;

export type DropResult = { ok: true; removed: PersonFieldKey[]; kept: PersonFieldKey[] } | { ok: false; reason: "read" | "write" | "conflict" };

/**
 * 한 사람의 주는 값을 이 지점 학원 설정에서 뺀다(바뀐 것이 없으면 쓰지 않는다).
 * `role` = 그 사람의 역할 — 개인별 메뉴 권한 줄이 역할보다 더 주는지 견주는 기준(`userOverrideGrants`). 모르면 null(개인 메뉴 줄은 남긴다).
 */
export async function dropPersonFromSettings(tenantId: string, userId: string, role: SystemRole | null, db: Db = createAdminClient()): Promise<DropResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: row, error } = await db.from("tenant_settings").select("data, updated_at").eq("tenant_id", tenantId).maybeSingle();
    if (error) {
      console.error("[owner/retired-people] tenant_settings 조회 오류 — 퇴사자 정리 건너뜀", error);
      return { ok: false, reason: "read" };
    }
    if (!row) return { ok: true, removed: [], kept: [] };
    const result = removePersonFromStored(row.data, userId, role);
    if (result.removed.length === 0) return { ok: true, removed: [], kept: result.kept };
    // 지우는 칸은 모두 역할·권한 섹션 안이다 — 그 섹션 순번을 올린다.
    const next = result.data as Record<string, unknown>;
    const data = { ...next, permissions: { ...(next.permissions as Record<string, unknown>), rev: settingsRevOf((row.data as { permissions?: unknown } | null)?.permissions) + 1 } };
    const write = await db.from("tenant_settings").update({ data, updated_at: nextSettingsStamp(row.updated_at) })
      .eq("tenant_id", tenantId).eq("updated_at", row.updated_at).select("tenant_id");
    if (write.error) {
      console.error("[owner/retired-people] tenant_settings 쓰기 오류 — 퇴사자 정리 실패", write.error);
      return { ok: false, reason: "write" };
    }
    if (write.data?.length) return { ok: true, removed: result.removed, kept: result.kept };
    // 0행 = 그사이 다른 저장이 먼저 썼다 — 그 값 위에서 다시 뺀다.
  }
  console.error("[owner/retired-people] 다른 저장과 3번 겹쳐 퇴사자 정리를 하지 못했습니다", { tenantId, userId });
  return { ok: false, reason: "conflict" };
}

export type CleanupReason = "retire" | "reactivate" | "delete";

/**
 * 직원관리의 퇴사 경로(퇴사 · 인계 후 퇴사 · 다시 재직으로 · 완전 삭제)가 부르는 한 곳 — 정리 + 감사로그(뺀 칸 · 남긴 칸 · 실패) + 설정 캐시 비우기.
 * 감사로그는 지금 로그인한 사람의 지점에 남는다(`logAction`) — 직원관리는 그 지점 안의 일이다. 운영 콘솔 경로는 운영 감사에 따로 남긴다.
 * 🔴 다시 재직으로 돌릴 때도 부른다 — 퇴사 동안 화면·판정에서 걸러지던 옛 주는 값(이 정리 전에 남은 것)이 재입사로 되살아나지 않게(원장이 다시 지정한다).
 * 서버 액션 안에서만 부른다(`updateTag`). 실패해도 던지지 않는다 — 퇴사는 이미 저장됐고, 읽는 쪽이 퇴사자를 거른다.
 * 실패도 감사로그에 남긴다(`failed` — 리뷰 r1 F8): 정리가 안 된 채 재입사하면 옛 주는 값이 되살아나므로 원장이 알아야 한다.
 */
export async function cleanupPersonSettings(args: { tenantId: string; userId: string; role: SystemRole | null; targetLabel: string | null; reason: CleanupReason }): Promise<DropResult> {
  let result: DropResult = { ok: false, reason: "read" };
  try {
    result = await dropPersonFromSettings(args.tenantId, args.userId, args.role);
  } catch (e) {
    console.error("[owner/retired-people] 퇴사자 권한 정리 실패", e);
    result = { ok: false, reason: "write" };
  }
  const base = { userId: args.userId, reason: args.reason };
  const metadata = result.ok ? { ...base, removed: result.removed, kept: result.kept } : { ...base, failed: result.reason };
  if (!result.ok || result.removed.length > 0 || result.kept.length > 0) {
    try {
      await logAction({ action: "staff_permission_cleanup", targetType: "staff", targetLabel: args.targetLabel, metadata });
    } catch (e) {
      console.error("[owner/retired-people] 퇴사자 권한 정리 감사로그 실패", e);
    }
  }
  try {
    // 정리한 것이 없어도 비운다 — 읽는 쪽의 퇴사자 조회도 같은 태그로 캐시돼 있다(재직 상태가 바뀐 것을 바로 본다).
    updateTag(tenantSettingsTag(args.tenantId));
  } catch (e) {
    console.error("[owner/retired-people] 설정 캐시 비우기 실패", e);
  }
  return result;
}
