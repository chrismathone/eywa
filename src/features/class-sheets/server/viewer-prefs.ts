import "server-only";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * **보는 사람**(실제 로그인 계정)의 `users.ui_prefs` — ECS 화면 표시 취향(글씨 크기 · JJ 표시 · 로스터 접힘 ·
 * 프로그램/담임 필터 · 월간 보기 · 반 계획 보기)의 **단일 읽기 경로**.
 *
 * 🔴 왜 실제 계정인가: 이 값들의 **쓰기**(`patchMyUiPrefs` — actions.ts `setMyEcs*`, goals-board-actions.ts)는 언제나
 *    실제 계정에 저장한다(보는 사람의 화면 선호 — 강사뷰 신원 정책 2). 그런데 읽기가 강사뷰 대상(X)의 행을 읽고 있어,
 *    관리자가 강사 X의 화면에서 글씨를 키우면 자기 계정에 저장되고 화면은 X의 값으로 다시 그려져 **눌러도 안 바뀌는**
 *    토글이 됐다(2026-11-05 강사뷰 신원 점검). 오래된 필터 지우기(`freshRawUiPrefs`)도 실제 계정 행을 지우므로,
 *    X의 행을 읽어 넘기면 남의 값을 보고 내 값을 지웠다.
 * ⚠️ **반 순서**(`todayOrder` · `landingOrder`)는 여기서 읽지 않는다 — 화면 주인의 반 목록에 묶인 값이라
 *    '다른 강사 뷰'에서는 그 강사가 저장한 순서를 읽는다(원장 2026-09-05, today.ts·queries.ts `orderOwner`).
 *    보는 사람의 순서에는 그 강사의 반 id가 없어 기본 순서로 무너진다.
 * ⚠️ admin은 RLS 우회라 `tenant_id`를 함께 건다([[#104]]). 조회 실패는 기본값으로 떨어진다(표시 전용 — 종전과 같다).
 */
export const loadViewerUiPrefs = cache(async (): Promise<{ data: { ui_prefs: unknown } | null }> => {
  const viewer = await getCurrentUser();
  if (!viewer) return { data: null };
  const { data } = await createAdminClient()
    .from("users")
    .select("ui_prefs")
    .eq("id", viewer.id)
    .eq("tenant_id", viewer.tenantId)
    .maybeSingle();
  return { data: (data as { ui_prefs: unknown } | null) ?? null };
});
