import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * `users.ui_prefs.<ns>`의 키 몇 개를 **본인 계정**에 부분 저장하는 **단일 구현**.
 *
 * 🔴 CLAUDE.md: *"병합 로직을 설정마다 복붙하지 말 것 — 두 벌이 되면 한쪽만 고쳐 형제 키를 날리는
 *    사고가 난다."* ECS(`ui_prefs.ecs`)가 쓰던 `patchMyEcsPrefs`를 여기로 끌어올리고, 강사뷰 언어
 *    (`ui_prefs.teacherView`)가 같은 구현을 쓴다. 새 화면 설정도 여기를 부를 것.
 *
 * 🔴 **이 모듈은 `"use server"`가 아니다** — 그랬다면 `ns`를 받는 이 함수가 그대로 서버 액션이 되어
 *    클라가 **아무 네임스페이스나** 골라 쓸 수 있게 된다. 액션은 화면별로 얇게 감싸고(ns는 그쪽이
 *    코드로 고정) 이 구현은 서버 안에만 둔다.
 *
 * ⚠️ ui_prefs는 화면별 네임스페이스라 **`ns` 키만 갈아끼우고 형제 키는 보존**한다.
 * ⚠️ 값이 `undefined`면 그 키를 **지운다**(기본값은 저장하지 않아 빈 값이 쌓이지 않게).
 *    남은 키가 0개면 네임스페이스 자체를 지운다.
 * ⚠️ RLS 우회(admin)라 **`tenant_id`까지 좁힌다**.
 */
export async function patchMyUiPrefs(
  ns: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: explainDbError(readErr, { scope: "ui-prefs.patch", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};
  const scope =
    raw[ns] && typeof raw[ns] === "object" && !Array.isArray(raw[ns])
      ? { ...(raw[ns] as Record<string, unknown>) }
      : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete scope[key];
    else scope[key] = value;
  }

  const merged = { ...raw };
  if (Object.keys(scope).length === 0) delete merged[ns];
  else merged[ns] = scope;

  const { error } = await admin
    .from("users")
    .update({ ui_prefs: merged })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: explainDbError(error, { scope: "ui-prefs.patch", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}
