import "server-only";

import { cache } from "react";

import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseViewPrefs, type TimetableViewPrefs } from "../lib/view-prefs";

type EntryPreferences = { viewPrefs: TimetableViewPrefs; subjects: string[] };
const subjectKeys = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((key): key is string => typeof key === "string") : [];

/**
 * 로그인 사용자의 시간표 뷰 설정(0146a users.ui_prefs).
 *
 * ⚠️ 읽기는 **서버 컴포넌트 첫 렌더**에서 끝나야 한다 — 클라에서 교정하면 필터 없는 화면을 한 번
 * 그렸다가 학생이 사라지는 깜빡임이 생긴다(쿠키를 쓰던 이유와 같은 이유, prefs-sync.tsx 주석 참조).
 *
 * 미로그인·조회 실패·깨진 jsonb는 전부 '설정 없음'으로 떨어진다(무중단 — 설정 하나 때문에
 * 시간표가 안 열리면 안 된다).
 */
const getMyTimetableAccountPreferences = cache(async (): Promise<EntryPreferences> => {
  const user = await getCurrentUser();
  if (!user) return { viewPrefs: parseViewPrefs(null), subjects: [] };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("users")
    .select("ui_prefs, subjects")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  return {
    viewPrefs: parseViewPrefs(error ? null : data?.ui_prefs),
    subjects: subjectKeys(error ? null : data?.subjects),
  };
});

export const getMyTimetableViewPrefs = cache(async (): Promise<TimetableViewPrefs> => {
  return (await getMyTimetableAccountPreferences()).viewPrefs;
});

/** 일반 진입은 기존 계정 설정 조회 한 번으로 끝난다. 다른 강사 뷰만 그 강사의 담당 과목을 읽는다. */
export const getTimetableEntryPreferences = cache(async (): Promise<EntryPreferences> => {
  const ownPromise = getMyTimetableAccountPreferences();
  const [user, teacherId] = await Promise.all([getCurrentUser(), effectiveTeacherId()]);
  if (!user || !teacherId || teacherId === user.id) return ownPromise;
  // 임의 id를 받지 않고 검증된 뷰 대상만 읽는다. 표시 선호는 여전히 로그인한 본인의 것이다.
  const supabase = await createClient();
  const [own, { data, error }] = await Promise.all([
    ownPromise,
    supabase.from("users").select("subjects")
      .eq("id", teacherId).eq("tenant_id", user.tenantId).maybeSingle(),
  ]);
  return { viewPrefs: own.viewPrefs, subjects: subjectKeys(error ? null : data?.subjects) };
});
