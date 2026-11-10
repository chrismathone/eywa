"use server";

/**
 * 출석부 **개인 보기 설정** — 접힌 반·정렬·날짜축·퇴직자 숨김. 전부 `users.ui_prefs.attendance`(본인 계정)다.
 *
 * 🔴 **이 파일엔 감사로그(`logAction`)가 없다 — 빠뜨린 게 아니다**(2026-09-09 출결 감사 배선 때 확인).
 *    여기서 바뀌는 건 **내 화면이 어떻게 보이는지**뿐이고 출결·시수·급여·집계는 이 값을 한 글자도 읽지
 *    않는다(각 함수 주석의 "표시 렌즈"). 남기면 감사로그가 접기/펼치기로 뒤덮여 정작 되짚어야 할 줄
 *    (출결 삭제·소급 변경)이 묻힌다 — 회의록 메모장(`updateMeetingNotepad`)을 일부러 안 남기는 것과 같은 결.
 * ⚠️ 이 파일에 **남의 화면·학원 단위 설정**을 저장하는 액션이 생기면 그건 다른 물건이다(그땐 남긴다).
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  parseAttendanceViewPrefs,
  parsePeriodMode,
  type AttendanceViewPrefs,
  type PeriodMode,
} from "../view-prefs";
import { parseAttendanceSortKey, type AttendanceSortKey } from "../sort-rows";
import { explainDbError } from "@/lib/supabase/db-error";

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
 * ⚠️ 통째 저장을 쓰면 안 되는 자리다(그래서 통째 저장 액션은 두지 않는다 — 감사 D9에서 호출처 0이라 삭제): 정렬 드롭다운이 들고 있는 collapsed는
 *    서버 렌더 시점 값이라, 그 사이 사용자가 접은 반이 되돌아간다(마지막 쓰기가 이긴다).
 */
export async function saveAttendanceSort(
  sort: AttendanceSortKey,
): Promise<{ ok: boolean; error?: string }> {
  const safe = parseAttendanceSortKey(sort);
  return mergeAttendancePrefs((prev) => ({ ...prev, sort: safe }));
}

/**
 * 날짜축 모드만 저장 — 접힌 반·정렬은 건드리지 않는다.
 * ⚠️ 이건 **표시 렌즈**다. 청구·시수검증·급여는 이 값을 읽지 않는다(계정마다 금액이 달라 보이면 안 된다).
 */
export async function saveAttendancePeriodMode(
  mode: PeriodMode,
): Promise<{ ok: boolean; error?: string }> {
  const safe = parsePeriodMode(mode);
  return mergeAttendancePrefs((prev) => ({ ...prev, periodMode: safe }));
}

/**
 * 퇴직자 숨김만 저장 — 접힌 반·정렬·날짜축은 건드리지 않는다.
 * ⚠️ 이건 **강사 선택지의 표시 렌즈**다. 반·출결·집계는 이 값을 읽지 않는다(감춘다고 기록이 빠지지 않는다).
 */
export async function saveAttendanceHideRetired(
  hideRetired: boolean,
): Promise<{ ok: boolean; error?: string }> {
  return mergeAttendancePrefs((prev) => ({ ...prev, hideRetired: hideRetired !== false }));
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
  if (readErr) return { ok: false, error: explainDbError(readErr, { scope: "attendance.prefs-actions.mergeAttendancePrefs", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};

  const { error } = await admin
    .from("users")
    .update({ ui_prefs: { ...raw, attendance: update(parseAttendanceViewPrefs(raw.attendance)) } })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: explainDbError(error, { scope: "attendance.prefs-actions.mergeAttendancePrefs", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
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
