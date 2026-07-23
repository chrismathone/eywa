import "server-only";

import { cache } from "react";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseViewPrefs, type TimetableViewPrefs } from "../lib/view-prefs";

/**
 * 로그인 사용자의 시간표 뷰 설정(0146a users.ui_prefs).
 *
 * ⚠️ 읽기는 **서버 컴포넌트 첫 렌더**에서 끝나야 한다 — 클라에서 교정하면 필터 없는 화면을 한 번
 * 그렸다가 학생이 사라지는 깜빡임이 생긴다(쿠키를 쓰던 이유와 같은 이유, prefs-sync.tsx 주석 참조).
 *
 * 미로그인·조회 실패·깨진 jsonb는 전부 '설정 없음'으로 떨어진다(무중단 — 설정 하나 때문에
 * 시간표가 안 열리면 안 된다).
 */
export const getMyTimetableViewPrefs = cache(async (): Promise<TimetableViewPrefs> => {
  const user = await getCurrentUser();
  if (!user) return parseViewPrefs(null);
  const admin = createAdminClient();
  const { data } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  return parseViewPrefs(data?.ui_prefs);
});
