"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTenantSettings } from "@/features/owner/server/queries";
import {
  mergeViewPrefs,
  normalizeGradeSelection,
  parseViewPrefs,
  serializeViewPrefs,
  type TimetableViewPrefs,
} from "../lib/view-prefs";
import { explainDbError } from "@/lib/supabase/db-error";
import { writeUiPrefsNs } from "@/lib/ui-prefs/write";

/**
 * 시간표 '뷰 설정'을 **본인 계정**에 저장한다(0146a users.ui_prefs).
 *
 * admin client + (id, tenant_id) 스코프 — RLS 우회지만 자기 행만 강제한다(0104a setMyNoticeMode와 동일 규약).
 *
 * ⚠️ **부분 저장(patch)** 이다 — 넘어온 키만 바꾼다. 쓰는 곳이 여럿(필터 패널·표시 토글 동기화·색 강도
 * 토글)이라 통째로 덮으면 서로의 값을 날린다. `undefined`=안 건드림, `null`=명시적 해제.
 *
 * ⚠️ ui_prefs는 화면별 네임스페이스라 **timetable 키만 갈아끼우고 형제 키는 보존**한다
 * (다른 화면 설정을 지우면 안 된다 — tenant_settings 섹션 머지와 같은 이유).
 *
 * ⚠️ `revalidatePath`를 **부르지 않는다** — 이 액션은 표시 토글 동기화(useEffect)에서도 불리는데,
 * 여기서 경로를 무효화하면 리렌더 → 재저장 → 재무효화로 왕복이 늘어난다. 화면 갱신이 필요한
 * 호출부(필터 패널)가 스스로 `router.refresh()`를 부른다.
 */
export async function saveTimetableViewPrefs(
  patch: Partial<TimetableViewPrefs>,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };

  const admin = createAdminClient();
  // 형제 키 보존 + 부분 병합을 위해 현재값을 먼저 읽는다.
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: explainDbError(readErr, { scope: "timetable.view-prefs-actions.saveTimetableViewPrefs", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};
  let next = mergeViewPrefs(parseViewPrefs(raw), patch);

  // 학년은 학원설정(operations.gradeLevels)이 단일 소스 — 교집합을 내고 '전부 선택'은 null로 정규화한다
  // (사용자가 스스로를 빈 화면에 가두지 못하게). 학년을 안 건드리는 저장에선 이 조회를 생략한다.
  if (patch.grades !== undefined) {
    const settings = await getTenantSettings();
    next = {
      ...next,
      grades: normalizeGradeSelection(next.grades, settings.operations.gradeLevels ?? []),
    };
  }

  const timetable = serializeViewPrefs(next);
  // 설정이 전부 기본값이면 키 자체를 지운다(빈 객체가 쌓이지 않게 — 빈 객체 replace = 네임스페이스 삭제).
  const { error } = await writeUiPrefsNs(admin, { userId: user.id, tenantId: user.tenantId }, "timetable", { replace: timetable });
  if (error) return { ok: false, error: explainDbError(error, { scope: "timetable.view-prefs-actions.saveTimetableViewPrefs", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}
