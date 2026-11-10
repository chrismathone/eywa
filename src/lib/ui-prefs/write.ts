import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { isMissingFunction } from "@/lib/supabase/db-error";
import { isRecord } from "@/lib/guards";

type Admin = ReturnType<typeof createAdminClient>;
type DbErr = { code?: string; message: string; details?: string; hint?: string };

/**
 * `users.ui_prefs.<ns>` 쓰기 — **한 문장으로**(DB 함수 `ui_prefs_patch`, s2_0043 · 수정 계획 P2-R B16).
 *
 * 예전 저장 20곳은 ui_prefs **전체**를 읽어 JS에서 합친 뒤 통째로 다시 썼다 → 창 두 개(다른 화면)에서 거의 동시에 저장하면
 * 늦게 쓴 쪽이 먼저 쓴 쪽의 **다른 네임스페이스**를 옛 값으로 되돌렸다(보기 설정이 "가끔 풀린다").
 * 이제 DB가 그 네임스페이스만 고친다 — 다른 화면의 설정은 건드리지 않는다.
 *
 *  · `set`(키 단위): 그 네임스페이스 객체에서 `unset` 키를 지우고 `set`을 덮는다.
 *  · `replace`: 네임스페이스 값을 통째로 바꾼다(그 화면 안 계산은 호출부 몫 — 다른 화면은 안전).
 *  · 결과가 빈 객체면 네임스페이스를 지운다.
 *
 * ⚠️ admin(서비스 역할)으로 부른다 — 대상은 **본인 계정**(`userId`·`tenantId`를 호출부가 세션에서 넘긴다).
 * ⚠️ 함수가 아직 없으면(SQL 미적용, #95) 종전 읽고-합치고-쓰기로 돌아간다.
 */
export async function writeUiPrefsNs(
  admin: Admin,
  who: { userId: string; tenantId: string },
  ns: string,
  change: { set?: Record<string, unknown>; unset?: readonly string[] } | { replace: unknown },
): Promise<{ error: DbErr | null }> {
  const replace = "replace" in change;
  const pSet = replace ? (change.replace ?? null) : (change.set ?? {});
  const pUnset = replace ? [] : [...(change.unset ?? [])];
  const { error } = await admin.rpc("ui_prefs_patch", {
    p_user: who.userId,
    p_tenant: who.tenantId,
    p_ns: ns,
    p_set: pSet as never,
    p_unset: pUnset,
    p_replace: replace,
  });
  if (!error) return { error: null };
  if (!isMissingFunction(error, "ui_prefs_patch")) return { error };
  return legacyWrite(admin, who, ns, replace, pSet, pUnset);
}

/** SQL 미적용 지점 폴백 — 종전 동작(통째 쓰기) 그대로. */
async function legacyWrite(
  admin: Admin,
  who: { userId: string; tenantId: string },
  ns: string,
  replace: boolean,
  pSet: unknown,
  pUnset: readonly string[],
): Promise<{ error: DbErr | null }> {
  const { data, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", who.userId)
    .eq("tenant_id", who.tenantId)
    .maybeSingle();
  if (readErr) return { error: readErr };
  const root = isRecord(data?.ui_prefs) ? { ...data.ui_prefs } : {};
  let next: unknown;
  if (replace) next = pSet;
  else {
    const scope: Record<string, unknown> = isRecord(root[ns]) ? { ...root[ns] } : {};
    for (const k of pUnset) delete scope[k];
    Object.assign(scope, isRecord(pSet) ? pSet : {});
    next = scope;
  }
  if (next == null || (isRecord(next) && Object.keys(next).length === 0)) delete root[ns];
  else root[ns] = next;
  const { error } = await admin.from("users").update({ ui_prefs: root }).eq("id", who.userId).eq("tenant_id", who.tenantId);
  return { error };
}
