"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import type { ReferrerOption } from "../referrer";
import { listReferrerOptions } from "./referrer-queries";

/**
 * 콜&상담 '소개한 사람' 고르기 목록 — 칸을 **처음 열 때만** 부른다(수정 화면을 열 때마다 학생 전체를 읽지 않게).
 * 콜&상담 쓰기 권한(상담을 저장하는 문과 같은 문)이 있어야 한다.
 */
export async function loadReferrerOptions(): Promise<{ ok: true; options: ReferrerOption[] } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "enrollment"))) return { ok: false, error: "콜&상담 권한이 없습니다" };
  try {
    return { ok: true, options: await listReferrerOptions((await createClient()) as unknown as SupabaseClient, user.tenantId) };
  } catch (e) {
    console.error("[enrollment/referrer] 고르기 목록 조회 실패", e instanceof Error ? e.message : e);
    return { ok: false, error: "목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." };
  }
}
