"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  parseAttendanceViewPrefs,
  type AttendanceViewPrefs,
} from "../view-prefs";
import { parseAttendanceSortKey, type AttendanceSortKey } from "../sort-rows";

/**
 * 출석부 보기 설정을 **본인 계정**에 저장 — `users.ui_prefs.attendance`.
 *
 * ⚠️ ui_prefs는 화면별 네임스페이스다 — `attendance` 키만 갈아끼우고 **형제 키(ecs·timetable·onescreen…)는
 *    보존**한다. 통째로 덮으면 다른 화면 설정이 조용히 날아간다.
 * ⚠️ 권한은 로그인만 본다 — 내 화면의 표시 취향이라 출결 쓰기 권한과 무관하다(읽기 전용 강사도 접을 수 있다).
 * ⚠️ `revalidatePath` 없음: 접기는 클라가 즉시 반영하고 이 저장은 **다음 방문용**이다. 되살리면 반을
 *    접을 때마다 그 달 매트릭스를 통째로 다시 읽는다.
 */
export async function saveAttendanceViewPrefs(
  next: AttendanceViewPrefs,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };

  // 클라가 보낸 값을 그대로 믿지 않는다 — 파서를 한 번 태운다.
  const safe = parseAttendanceViewPrefs(next);

  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};

  const { error } = await admin
    .from("users")
    .update({ ui_prefs: { ...raw, attendance: safe } })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * 접힌 반 목록만 저장 — 정렬 기준은 **건드리지 않는다**.
 * ⚠️ 반을 접을 때마다 클라가 들고 있는 `sort`를 함께 쓰면, 다른 탭·다른 창에서 바꾼 정렬이 되돌아간다.
 */
export async function saveAttendanceCollapsed(
  collapsed: string[],
): Promise<{ ok: boolean; error?: string }> {
  return mergeAttendancePrefs((prev) => ({ ...prev, collapsed: parseAttendanceViewPrefs({ collapsed }).collapsed }));
}

/**
 * 정렬 기준만 저장 — 접힌 반 목록은 **건드리지 않는다**.
 * ⚠️ 통째 저장(`saveAttendanceViewPrefs`)을 쓰면 안 되는 자리다: 정렬 드롭다운이 들고 있는 collapsed는
 *    서버 렌더 시점 값이라, 그 사이 사용자가 접은 반이 되돌아간다(마지막 쓰기가 이긴다).
 */
export async function saveAttendanceSort(
  sort: AttendanceSortKey,
): Promise<{ ok: boolean; error?: string }> {
  const safe = parseAttendanceSortKey(sort);
  return mergeAttendancePrefs((prev) => ({ ...prev, sort: safe }));
}

/**
 * `ui_prefs.attendance`를 **필드 단위로** 갱신 — 읽고 → 고칠 필드만 바꿔 → 되쓴다.
 * ⚠️ 형제 키(ecs·timetable·onescreen…)는 물론 **같은 attendance 안의 다른 필드도** 보존한다.
 *    화면마다 통째로 덮으면 마지막에 저장한 쪽이 나머지를 되돌린다.
 */
async function mergeAttendancePrefs(
  update: (prev: AttendanceViewPrefs) => AttendanceViewPrefs,
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
  if (readErr) return { ok: false, error: readErr.message };

  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};

  const { error } = await admin
    .from("users")
    .update({ ui_prefs: { ...raw, attendance: update(parseAttendanceViewPrefs(raw.attendance)) } })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** 저장된 설정 읽기 — 없거나 깨졌으면 기본값(파서가 흡수). */
export async function loadAttendanceViewPrefs(): Promise<AttendanceViewPrefs> {
  const user = await getCurrentUser();
  if (!user) return parseAttendanceViewPrefs(undefined);
  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const raw = data?.ui_prefs as Record<string, unknown> | null | undefined;
  return parseAttendanceViewPrefs(raw?.attendance);
}
