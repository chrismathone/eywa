"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { tenantSettingsTag } from "./queries";
import { SECTION_SCHEMAS, type SectionKey } from "../settings-types";

export type OwnerSaveState = { ok?: boolean; error?: string; nonce?: number } | undefined;

const SECTION_LABELS: Record<SectionKey, string> = {
  profile: "학원 프로필·브랜드",
  operations: "운영 체계",
  billing: "수납·청구 기본값",
  notifications: "알림·연동·약관",
  permissions: "역할별 메뉴 권한",
};

/**
 * 학원 설정 섹션 1개 저장. master 전용. data(JSON)를 섹션 Zod로 검증 후 기존 jsonb에 머지(섹션 단위
 * 덮어쓰기 — 다른 섹션 보존). best-effort 감사로그 + 셸 전역 revalidate(브랜드·과목 등 반영).
 */
export async function saveOwnerSection(
  _prev: OwnerSaveState,
  formData: FormData,
): Promise<OwnerSaveState> {
  const actor = await getCurrentUser();
  if (!actor) return { error: "로그인이 필요합니다" };
  if (actor.systemRole !== "master") {
    return { error: "학원 설정은 원장(master)만 변경할 수 있습니다" };
  }

  const section = String(formData.get("section") ?? "") as SectionKey;
  const schema = SECTION_SCHEMAS[section];
  if (!schema) return { error: "알 수 없는 설정 섹션입니다" };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(String(formData.get("data") ?? "null"));
  } catch {
    return { error: "설정 데이터 형식이 올바르지 않습니다" };
  }

  const result = schema.safeParse(parsedJson);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join(".");
    return { error: `입력값 오류${path ? ` (${path})` : ""}: ${first?.message ?? "검증 실패"}` };
  }

  const supabase = await createClient();
  // 기존 문서 읽어 섹션만 교체(다른 섹션 보존). RLS로 자기 테넌트만.
  const { data: existing } = await supabase
    .from("tenant_settings")
    .select("data")
    .eq("tenant_id", actor.tenantId)
    .maybeSingle();

  const base = (existing?.data as Record<string, unknown> | null) ?? {};
  const nextData = { ...base, version: 1, [section]: result.data };

  const { error } = await supabase.from("tenant_settings").upsert(
    {
      tenant_id: actor.tenantId,
      data: nextData,
      updated_by: actor.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) return { error: error.message };

  await logAction({
    action: "owner_settings_update",
    targetType: "tenant_settings",
    targetLabel: SECTION_LABELS[section],
    metadata: { section },
  });

  // 설정 캐시(unstable_cache, tenantId별) 무효화 — updateTag는 server action 전용 read-your-writes
  //   (같은 요청 내 즉시 만료·갱신)라 저장 직후 master가 새 값을 바로 본다. 아래 revalidatePath("/",
  //   "layout")은 문서상 unstable_cache 태그 무효화 폴백 겸 셸 재렌더(브랜드·과목 반영) 역할.
  updateTag(tenantSettingsTag(actor.tenantId));
  // 브랜드·과목·직급 등은 셸 전역에 쓰이므로 루트 레이아웃까지 갱신.
  revalidatePath("/", "layout");
  revalidatePath("/owner");
  // nonce — in-window 저장이라 연속 저장마다 폼 effect가 동시편집 신호를 1회씩 발화하도록(B-2).
  return { ok: true, nonce: Date.now() };
}
