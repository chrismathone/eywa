"use server";

import { revalidatePath, updateTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { normalizeNoticeAudience, POPUP_POSITIONS } from "../audience";
import { noticePopupsTag } from "./queries";

export type NoticePopupActionState = { error?: string; ok?: boolean } | undefined;

function parseDt(v: string): string | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function readForm(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const audience = normalizeNoticeAudience(get("audience"));
  const positionRaw = get("position") || "cascade";
  const position = (POPUP_POSITIONS as readonly string[]).includes(positionRaw) ? positionRaw : "cascade";
  const width = Math.min(720, Math.max(280, Number(get("width")) || 380));
  const priority = Math.max(0, Math.min(999, Math.round(Number(get("priority")) || 0)));
  const linkUrl = get("linkUrl");
  return {
    id: get("id"),
    title: get("title"),
    body: get("body") || null,
    imageUrl: get("imageUrl") || null,
    linkUrl: linkUrl && /^https?:\/\//i.test(linkUrl) ? linkUrl : null,
    linkLabel: get("linkLabel") || null,
    audience,
    width,
    position,
    priority,
    isActive: formData.get("isActive") === "on" || formData.get("isActive") === "true",
    startsAt: parseDt(get("startsAt")),
    endsAt: parseDt(get("endsAt")),
  };
}

// 팝업 공지 = owner 콘솔(관리 › 팝업 공지) 전용 → 게이트도 owner 메뉴 쓰기(override 반영, #58) —
// 원장이 admin/manager에게 owner를 위임하면 함께 열린다(owner 콘솔 나머지와 정합). 대시보드 '공지'(broadcast)는
// dashboard 소속이라 별개(canManageStaff 유지).
async function gate() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "owner"))) {
    return { error: "학원 설정(owner) 변경 권한이 없습니다" as const };
  }
  return { user };
}

function invalidate(tenantId: string) {
  // 셸 레이아웃이 표시 팝업을 캐시(unstable_cache, tenantId별)로 읽으므로 태그 무효화 + 레이아웃 재렌더.
  updateTag(noticePopupsTag(tenantId));
  revalidatePath("/", "layout");
  revalidatePath("/owner");
}

export async function createNoticePopup(
  _prev: NoticePopupActionState,
  formData: FormData,
): Promise<NoticePopupActionState> {
  const g = await gate();
  if ("error" in g) return g;
  const input = readForm(formData);
  if (!input.title) return { error: "제목을 입력해주세요" };
  if (!input.body && !input.imageUrl) return { error: "본문 또는 이미지를 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase.from("notice_popups").insert({
    tenant_id: g.user.tenantId,
    title: input.title,
    body: input.body,
    image_url: input.imageUrl,
    link_url: input.linkUrl,
    link_label: input.linkLabel,
    audience: input.audience,
    width: input.width,
    position: input.position,
    priority: input.priority,
    is_active: input.isActive,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    author_id: g.user.id,
  });
  if (error) return { error: error.message };

  await logAction({ action: "notice_popup_create", targetType: "notice_popup", targetLabel: input.title });
  invalidate(g.user.tenantId);
  return { ok: true };
}

export async function updateNoticePopup(
  _prev: NoticePopupActionState,
  formData: FormData,
): Promise<NoticePopupActionState> {
  const g = await gate();
  if ("error" in g) return g;
  const input = readForm(formData);
  if (!input.id) return { error: "팝업 ID가 누락되었습니다" };
  if (!input.title) return { error: "제목을 입력해주세요" };
  if (!input.body && !input.imageUrl) return { error: "본문 또는 이미지를 입력해주세요" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notice_popups")
    .update({
      title: input.title,
      body: input.body,
      image_url: input.imageUrl,
      link_url: input.linkUrl,
      link_label: input.linkLabel,
      audience: input.audience,
      width: input.width,
      position: input.position,
      priority: input.priority,
      is_active: input.isActive,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.id)
    .eq("tenant_id", g.user.tenantId);
  if (error) return { error: error.message };

  invalidate(g.user.tenantId);
  return { ok: true };
}

export async function toggleNoticePopupActive(
  _prev: NoticePopupActionState,
  formData: FormData,
): Promise<NoticePopupActionState> {
  const g = await gate();
  if ("error" in g) return g;
  const id = String(formData.get("id") ?? "").trim();
  const isActive = formData.get("isActive") === "true";
  if (!id) return { error: "팝업 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("notice_popups")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", g.user.tenantId);
  if (error) return { error: error.message };

  invalidate(g.user.tenantId);
  return { ok: true };
}

export async function deleteNoticePopup(
  _prev: NoticePopupActionState,
  formData: FormData,
): Promise<NoticePopupActionState> {
  const g = await gate();
  if ("error" in g) return g;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "팝업 ID가 누락되었습니다" };

  const supabase = await createClient();
  // 삭제 전 제목 확보 — 감사로그 targetLabel에 uuid 대신 사람이 읽는 제목을 남긴다.
  const { data: popup } = await supabase
    .from("notice_popups")
    .select("title")
    .eq("id", id)
    .eq("tenant_id", g.user.tenantId)
    .maybeSingle();
  const { error } = await supabase
    .from("notice_popups")
    .delete()
    .eq("id", id)
    .eq("tenant_id", g.user.tenantId);
  if (error) return { error: error.message };

  await logAction({
    action: "notice_popup_delete",
    targetType: "notice_popup",
    targetLabel: (popup?.title as string | undefined) ?? id,
  });
  invalidate(g.user.tenantId);
  return { ok: true };
}
