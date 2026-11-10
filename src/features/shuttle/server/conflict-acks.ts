"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { mergeAcks, parseAcks } from "../conflict-acks";
import { writeUiPrefsNs } from "@/lib/ui-prefs/write";

/**
 * 탑승 학생 시간표 "수정된 내용" **확인** — `users.ui_prefs.shuttleConflictAcks`에 열쇠를 더한다(사용자 2026-10-29).
 * ⚠️ 형제 키(`shuttleToday`·`timetable`…)는 보존한다 — 통째로 덮으면 남의 화면 설정이 날아간다(today-prefs와 같은 방식).
 * ⚠️ 권한은 로그인만 — 내 화면에서 경고를 접는 일이라 데이터를 바꾸지 않는다(화면 자체는 셔틀 관리자만 연다).
 */
export async function ackRideConflicts(keys: string[]): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin.from("users").select("ui_prefs").eq("id", user.id).eq("tenant_id", user.tenantId).maybeSingle();
  if (readErr) return { ok: false, error: "확인을 저장하지 못했어요" };
  const raw = row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs) ? (row.ui_prefs as Record<string, unknown>) : {};
  const next = mergeAcks(parseAcks(raw.shuttleConflictAcks), parseAcks(keys));
  const { error } = await writeUiPrefsNs(admin, { userId: user.id, tenantId: user.tenantId }, "shuttleConflictAcks", { replace: next });
  if (error) return { ok: false, error: "확인을 저장하지 못했어요" };
  return { ok: true };
}

/** 이 계정이 확인한 열쇠 — 비로그인·미저장이면 빈 배열. */
export async function loadRideConflictAcks(): Promise<string[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const { data } = await createAdminClient().from("users").select("ui_prefs").eq("id", user.id).eq("tenant_id", user.tenantId).maybeSingle();
  const raw = data?.ui_prefs as Record<string, unknown> | null | undefined;
  return parseAcks(raw?.shuttleConflictAcks);
}
