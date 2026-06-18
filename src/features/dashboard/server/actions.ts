"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { createClient } from "@/lib/supabase/server";

const AUDIENCES = ["all", "staff", "teachers", "counselors", "accounting"] as const;
type Audience = (typeof AUDIENCES)[number];

export type AnnouncementActionState = { error?: string; ok?: boolean } | undefined;

function readForm(formData: FormData) {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const audienceRaw = get("audience") || "all";
  const audience: Audience = (AUDIENCES as readonly string[]).includes(audienceRaw)
    ? (audienceRaw as Audience)
    : "all";
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
  if (!canManageStaff(user.systemRole)) return { error: "공지 작성 권한이 없습니다" };

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
  if (!canManageStaff(user.systemRole)) return { error: "공지 수정 권한이 없습니다" };

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
  if (!canManageStaff(user.systemRole)) return { error: "공지 삭제 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "공지 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase.from("announcements").delete().eq("id", id);
  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function toggleAnnouncementPin(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(user.systemRole)) return { error: "권한이 없습니다" };

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
