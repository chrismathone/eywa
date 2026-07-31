"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { dismissUntil, type DismissMode } from "../dismiss";

export type DismissResult = { ok: true } | { error: string };

const MODES: readonly DismissMode[] = ["today", "week", "forever"];

/**
 * 공지 팝업 "N일간/다시 보지 않기" — 계정 단위 저장(0162a). 브라우저·포트·PC가 달라도 따라온다.
 * version(=팝업 updated_at)은 **클라 값을 믿지 않고 서버가 다시 읽는다** — 그래야 "수정되면 재노출"의
 * 기준이 실제 DB 상태와 항상 일치한다(오래된 탭이 옛 버전을 보내 새 공지를 삼키는 것 차단).
 */
export async function dismissNoticePopup(
  popupId: string,
  mode: DismissMode,
): Promise<DismissResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!popupId || !MODES.includes(mode)) return { error: "요청이 올바르지 않습니다" };

  const supabase = await createClient();
  const { data: popup } = await supabase
    .from("notice_popups")
    .select("updated_at")
    .eq("id", popupId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!popup) return { error: "공지를 찾을 수 없습니다" };

  const until = dismissUntil(mode, Date.now());
  const { error } = await supabase.from("notice_dismissals").upsert(
    {
      tenant_id: user.tenantId,
      user_id: user.id,
      popup_id: popupId,
      version: popup.updated_at as string,
      until: until === null ? null : new Date(until).toISOString(),
    },
    { onConflict: "user_id,popup_id" },
  );
  if (error) return { error: "설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." };

  return { ok: true };
}

/** 체크 해제 — 이 공지를 다시 보이게 한다(행 삭제). RLS가 내 행만 허용하므로 남의 설정은 못 지운다. */
export async function undismissNoticePopup(popupId: string): Promise<DismissResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!popupId) return { error: "요청이 올바르지 않습니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notice_dismissals")
    .delete()
    .eq("user_id", user.id)
    .eq("popup_id", popupId);
  if (error) return { error: "설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요." };

  return { ok: true };
}
