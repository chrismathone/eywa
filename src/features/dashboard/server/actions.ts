"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { normalizeNoticeAudience } from "@/features/notices/audience";
import { generateDailyBriefing } from "./briefing";

export type AnnouncementActionState = { error?: string; ok?: boolean } | undefined;

function readForm(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const audience = normalizeNoticeAudience(get("audience"));
  return {
    id: get("id"),
    title: get("title"),
    content: get("content"),
    audience,
    pinned: formData.get("pinned") === "on" || formData.get("pinned") === "true",
  };
}

export async function createAnnouncement(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "dashboard"))) {
    return { error: "공지 작성 권한이 없습니다" };
  }

  const input = readForm(formData);
  if (!input.title) return { error: "제목을 입력해주세요" };
  if (!input.content) return { error: "내용을 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase.from("announcements").insert({
    tenant_id: user.tenantId,
    title: input.title,
    content: input.content,
    audience: input.audience,
    pinned: input.pinned,
    author_id: user.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateAnnouncement(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "dashboard"))) {
    return { error: "공지 수정 권한이 없습니다" };
  }

  const input = readForm(formData);
  if (!input.id) return { error: "공지 ID가 누락되었습니다" };
  if (!input.title) return { error: "제목을 입력해주세요" };
  if (!input.content) return { error: "내용을 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("announcements")
    .update({
      title: input.title,
      content: input.content,
      audience: input.audience,
      pinned: input.pinned,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteAnnouncement(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "dashboard"))) {
    return { error: "공지 삭제 권한이 없습니다" };
  }

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "공지 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("announcements").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}

/**
 * 일일 브리핑 '다시 생성' — 유일한 사용자 트리거 AI 호출(유료 호출 통제: 카드 노출과 동일한
 * master/admin/manager + dashboard write 게이트). enrollment 재분석 패턴 복제:
 * 원자 claim(analyzing 선점, updated_at 5분 stuck 우회) → after() 백그라운드 → 클라 5초 폴링 갱신.
 * 재생성은 벨 알림을 다시 쏘지 않는다(notified_at 게이트는 최초 생성 전용).
 */
export async function regenerateDailyBriefing(): Promise<{ error?: string; ok?: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "dashboard"))) {
    return { error: "브리핑을 다시 생성할 권한이 없습니다" };
  }

  const admin = createAdminClient();
  const tenantId = user.tenantId;
  const date = kstToday();
  const now = new Date();

  const { data: existing, error: readError } = await admin
    .from("daily_briefings")
    .select("id, processing_status, updated_at")
    .eq("tenant_id", tenantId)
    .eq("briefing_date", date)
    .maybeSingle();
  if (readError) return { error: `브리핑 상태 확인 실패: ${readError.message}` };

  if (existing) {
    const stuck =
      existing.processing_status === "analyzing" &&
      now.getTime() - new Date(existing.updated_at as string).getTime() > 5 * 60 * 1000;
    let claim = admin
      .from("daily_briefings")
      .update({ processing_status: "analyzing", processing_error: null, updated_at: now.toISOString() })
      .eq("id", existing.id);
    if (!stuck) claim = claim.neq("processing_status", "analyzing");
    const { data: claimed, error: claimError } = await claim.select("id");
    if (claimError) return { error: `브리핑 생성 시작 실패: ${claimError.message}` };
    if (!claimed || claimed.length === 0) {
      return { error: "이미 생성이 진행 중입니다. 완료되면 화면이 자동으로 갱신됩니다." };
    }
  } else {
    const { error: insertError } = await admin.from("daily_briefings").insert({
      tenant_id: tenantId,
      briefing_date: date,
      processing_status: "analyzing",
    });
    // 23505 = 동시 클릭 경합에서 상대가 먼저 행을 만든 것 — 진행 중으로 안내.
    if (insertError) {
      return insertError.code === "23505"
        ? { error: "이미 생성이 진행 중입니다. 완료되면 화면이 자동으로 갱신됩니다." }
        : { error: `브리핑 생성 시작 실패: ${insertError.message}` };
    }
  }

  revalidatePath("/dashboard");
  after(async () => {
    await generateDailyBriefing(tenantId, { notifyOnFirstGeneration: false });
  });
  return { ok: true };
}

export async function toggleAnnouncementPin(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "dashboard"))) {
    return { error: "권한이 없습니다" };
  }

  const id = String(formData.get("id") ?? "").trim();
  const pinned = formData.get("pinned") === "true";
  if (!id) return { error: "공지 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("announcements")
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}
