"use server";

/**
 * 오늘 출결 보기 설정 저장·조회 — `users.ui_prefs.attendanceLive`(원장 2026-08-20 과목별 필터).
 *
 * ⚠️ ui_prefs는 화면별 네임스페이스다 — `attendanceLive` 키만 갈아끼우고 **형제 키(attendance·ecs·
 *    timetable·onescreen…)는 보존**한다. 통째로 덮으면 다른 화면 설정이 조용히 날아간다.
 * ⚠️ 게이트는 **로그인만** 본다 — 내 화면의 표시 취향이라 출결 쓰기 권한과 무관하다(읽기 전용 강사도
 *    자기 화면을 좁혀 볼 수 있어야 한다). ECS `setMyEcsEnglishTrack`과 같은 규약.
 * ⚠️ `revalidatePath` 없음: **클라가 진실**이다(세 탭 모두 화면에서 좁힌다). 이 저장은 다음 방문용이라
 *    되살리면 칩을 누를 때마다 보드를 통째로 다시 읽는다.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { freshSavedFilters } from "@/lib/filter-reset/server";
import { parseLiveViewPrefs, parseSubjectFilter, type LiveViewPrefs } from "../view-prefs";
import { explainDbError } from "@/lib/supabase/db-error";
import { writeUiPrefsNs } from "@/lib/ui-prefs/write";

const NAMESPACE = "attendanceLive";

/**
 * 과목 필터만 저장 — 다른 필드는 건드리지 않는다.
 * ⚠️ **모양만** 검증한다. "그 과목이 지금 학원설정에 있나"는 저장 시점이 아니라 **읽는 시점**의 질문이라
 *    화면이 `resolveSubjectFilter`로 판정한다(ECS `setMyEcsTeacher`와 같은 이유 — 저장을 그때 막으면
 *    나중에 되살아날 과목을 지금 못 고르게 하는 셈이다).
 */
export async function saveLiveSubjectFilter(subject: string): Promise<{ ok: boolean; error?: string }> {
  const safe = parseSubjectFilter(subject);
  return mergeLivePrefs((prev) => ({ ...prev, subject: safe }));
}

/** 저장된 설정 읽기 — 없거나 깨졌으면 기본값(파서가 흡수). */
export async function loadLiveViewPrefs(): Promise<LiveViewPrefs> {
  const user = await getCurrentUser();
  if (!user) return parseLiveViewPrefs(undefined);
  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const raw = data?.ui_prefs as Record<string, unknown> | null | undefined;
  // 10분 넘게 안 본 화면이면 필터만 기본값으로(원장 2026-10-15 — src/lib/filter-reset/rules.ts).
  return freshSavedFilters("attendanceLive", parseLiveViewPrefs(raw?.[NAMESPACE]), parseLiveViewPrefs(undefined));
}

/** `ui_prefs.attendanceLive`를 **필드 단위로** 갱신 — 읽고 → 고칠 필드만 바꿔 → 되쓴다. */
async function mergeLivePrefs(
  update: (prev: LiveViewPrefs) => LiveViewPrefs,
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
  if (readErr) return { ok: false, error: explainDbError(readErr, { scope: "attendance.live.prefs-actions.mergeLivePrefs", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};

  const { error } = await writeUiPrefsNs(admin, { userId: user.id, tenantId: user.tenantId }, NAMESPACE, { replace: update(parseLiveViewPrefs(raw[NAMESPACE])) });
  if (error) return { ok: false, error: explainDbError(error, { scope: "attendance.live.prefs-actions.mergeLivePrefs", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}
