"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { freshSavedFilters } from "@/lib/filter-reset/server";
import { mergeStaffView, parseStaffListPrefs, pickStaffViewPrefs, type StaffListPrefs, type StaffViewPrefs } from "../list-prefs";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * `users.ui_prefs.staff`만 **필드 단위로** 갱신 — 직원목록 보기 설정(필터·정렬·볼 열·표 글자 크기 — 한 쪽 행 수는 창이 정해 저장하지 않는다).
 * 학생목록 `saveStudentListPrefs`·수업목록 `saveClassListPrefs`와 같은 규약.
 *
 * ⚠️ 형제 키(`students`·`classes`·`timetable`…)는 반드시 보존한다 — 통째로 덮으면 남의 화면 설정이 조용히 날아간다.
 * ⚠️ 권한은 로그인만 본다 — 내 화면의 표시 취향이라 직원관리 쓰기 권한과 무관하다(열람만 하는 사람도 열을 고른다).
 * ⚠️ 부분 객체를 보낸다 — `{ tableScale }`처럼 바뀐 키만. 다른 키를 함께 넘기면 그 값들이 덮인다.
 * ⚠️ `revalidatePath` 없음: 화면은 Provider·URL이 즉시 반영하고 이 저장은 **다음 방문용**이다.
 *
 * `base`(그 창이 저장돼 있다고 믿는 표 보기 값)를 함께 주면 열·글자는 **이 창이 바꾼 차이만** 저장값 위에 얹는다(`mergeStaffView` —
 * 다른 창·탭·PC가 그 사이 바꾼 값을 지우지 않는다). 돌려주는 `view`가 병합된 계정값이라 호출한 창은 그것으로 화면을 맞춘다.
 * `rev`는 저장마다 서버가 올린다(클라가 보낸 rev는 무시).
 */
export async function saveStaffListPrefs(
  next: Partial<StaffListPrefs>,
  base?: StaffViewPrefs,
): Promise<{ ok: boolean; error?: string; view?: StaffViewPrefs }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: explainDbError(readErr, { scope: "staff.list.list-prefs.saveStaffListPrefs", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  const raw =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs) ? (row.ui_prefs as Record<string, unknown>) : {};
  // 클라가 보낸 값을 그대로 믿지 않는다 — 파서를 한 번 태운다.
  const stored = parseStaffListPrefs(raw.staff);
  const patch: Partial<StaffListPrefs> = base ? { ...next, ...mergeStaffView(pickStaffViewPrefs(stored), base, next) } : { ...next };
  const merged = parseStaffListPrefs({ ...stored, ...patch, rev: stored.rev + 1 });
  const { error } = await admin
    .from("users")
    .update({ ui_prefs: { ...raw, staff: merged } })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: explainDbError(error, { scope: "staff.list.list-prefs.saveStaffListPrefs", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true, view: pickStaffViewPrefs(merged) };
}

/**
 * 저장된 보기 설정 — 비로그인·미저장이면 기본값(목록은 그대로 뜬다, fail-soft).
 * 🔴 **조회 실패는 기본값이 아니라 null**(학생목록과 같은 규약) — 기본값을 "저장값"으로 알면 RememberPrefs가 전체를 보내
 *    다른 축을 기본값으로 덮어쓴다. null이면 화면은 기본값으로 그리되 그 렌더는 저장하지 않는다.
 */
export async function loadStaffListPrefs(): Promise<StaffListPrefs | null> {
  const user = await getCurrentUser();
  if (!user) return parseStaffListPrefs(undefined);
  const admin = createAdminClient();
  const { data, error } = await admin.from("users").select("ui_prefs").eq("id", user.id).eq("tenant_id", user.tenantId).maybeSingle();
  if (error) return null;
  const raw = data?.ui_prefs as Record<string, unknown> | null | undefined;
  // 10분 넘게 안 본 화면이면 필터 키만 기본값으로(원장 2026-10-15 — src/lib/filter-reset/rules.ts). 정렬·보기는 그대로.
  return freshSavedFilters("staff", parseStaffListPrefs(raw?.staff), parseStaffListPrefs(undefined));
}
