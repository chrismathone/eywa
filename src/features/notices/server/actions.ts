"use server";

import { after } from "next/server";
import { revalidatePath, updateTag } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { MENU_LABEL } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { normalizeNoticeAudience, POPUP_POSITIONS } from "../audience";
import { noticePopupsTag } from "./queries";
// 영문 번역(0249a) — 저장 시점 백그라운드 · [영문 만들기] 버튼. 🔴 페이지 로드에서 부르지 말 것.
import { buildNoticeTranslation } from "./translate";
import { humanizeDbError, explainDbError } from "@/lib/supabase/db-error";
import { kstLocalToIso } from "@/lib/date-kst";

export type NoticePopupActionState = { error?: string; ok?: boolean } | undefined;

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
    // 🔴 노출 시작·종료는 `datetime-local`(시간대 없는 KST 벽시계)이다 — `new Date(값)`으로 읽으면 서버(UTC)가
    //    **9시간 늦게** 저장한다(원장 2026-10-14 *"강사 대상으로 작성하면 그 즉시 팝업되나"* — 15:58에 쓴 공지가
    //    다음 날 00:58부터로 앉아 아무에게도 안 떴다). 상담 시각과 같은 함수(date-kst).
    startsAt: kstLocalToIso(get("startsAt")),
    endsAt: kstLocalToIso(get("endsAt")),
  };
}

// 팝업 공지 = owner 콘솔(관리 › 팝업 공지) 전용 → 게이트도 owner 메뉴 쓰기(override 반영, #58) —
// 원장이 admin/manager에게 owner를 위임하면 함께 열린다(owner 콘솔 나머지와 정합). 대시보드 '공지'(broadcast)는
// dashboard 소속이라 별개(canManageStaff 유지).
async function gate() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "popup_settings"))) {
    return { error: `${MENU_LABEL.popup_settings} 변경 권한이 없습니다` };
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
  if ((input.body?.length ?? 0) > 8000) return { error: "본문은 메뉴 참조를 포함해 8,000자까지 입력해 주세요" };

  const supabase = await createClient();
  const { data: created, error } = await supabase.from("notice_popups").insert({
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
  }).select("id").maybeSingle();
  if (error) return { error: humanizeDbError(error.message, "등록") };

  await logAction({ action: "notice_popup_create", targetType: "notice_popup", targetLabel: input.title });
  invalidate(g.user.tenantId);
  if (created?.id) queueTranslation(created.id as string, input, g.user.tenantId);
  return { ok: true };
}

/**
 * 저장 직후 **백그라운드로** 영문 번역을 만든다(0249a) — 원장 2026-09-03 *"공지사항도 영어로 보이도록"*.
 *
 * 🔑 **사람이 [저장]을 누른 것이 곧 명시 트리거**다(CLAUDE.md *"AI 호출은 캐싱 + 명시적 트리거"*).
 *    페이지 로드에는 절대 붙이지 말 것 — 팝업은 셸 진입마다(= 창마다) 도는 경로라 창 수만큼 곱해진다(B6).
 * ⚠️ `after()`라 **저장 응답을 붙잡지 않는다**(v4-pro는 추론형이라 몇 초 걸린다). 실패해도 조용히
 *    넘어가고 화면은 한국어 원문을 그대로 쓴다 — 번역이 안 됐다고 공지 저장이 실패하면 안 된다.
 * ⚠️ 원문이 그대로면 `buildNoticeTranslation`이 해시로 걸러 **AI를 안 부른다**(이미지·기간만 고친 저장).
 */
function queueTranslation(
  noticeId: string,
  input: { title: string; body: string | null; linkLabel: string | null },
  tenantId: string,
): void {
  after(async () => {
    const r = await buildNoticeTranslation(
      noticeId,
      { title: input.title, body: input.body, linkLabel: input.linkLabel },
      tenantId,
    );
    // 새로 만들었으면 팝업 캐시를 비운다 — 안 그러면 최대 60초 동안 한국어가 남는다.
    if (r.ok) updateTag(noticePopupsTag(tenantId));
  });
}

/**
 * **[영문 만들기]** — 이미 있는 공지의 영문 번역을 지금 만든다(0249a). 원장 2026-09-03.
 *
 * 🔑 기존 공지들은 저장 시점이 이미 지나 캐시가 없다 → 사람이 누르는 **명시 트리거**가 필요하다
 *    (그것이 이 액션이다. 페이지 로드에서 자동으로 만들지 않는 이유는 `queueTranslation` 주석 참조).
 * ⚠️ `after()`가 아니라 **기다린다** — 버튼을 누른 사람에게 결과(성공·건너뜀·실패)를 그 자리에서
 *    보여줘야 한다. v4-pro라 몇 초 걸리지만 사람이 누르고 기다리는 자리다.
 * ⚠️ `force: true` — 해시가 같아도 다시 만든다(사람이 "다시 만들어라"라고 누른 것이다).
 */
export async function regenerateNoticeTranslation(
  _prev: NoticePopupActionState,
  formData: FormData,
): Promise<NoticePopupActionState> {
  const g = await gate();
  if ("error" in g) return g;
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "팝업 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data, error: readErr } = await supabase
    .from("notice_popups")
    .select("title, body, link_label")
    .eq("id", id)
    .eq("tenant_id", g.user.tenantId)
    .maybeSingle();
  if (readErr) return { error: explainDbError(readErr, { scope: "notices.actions.regenerateNoticeTranslation", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  if (!data) return { error: "팝업을 찾을 수 없습니다" };

  const r = await buildNoticeTranslation(
    id,
    {
      title: (data.title as string) ?? "",
      body: (data.body as string | null) ?? null,
      linkLabel: (data.link_label as string | null) ?? null,
    },
    g.user.tenantId,
    { force: true },
  );
  if (!r.ok) return { error: `영문 만들기 실패: ${r.error}` };
  // 건너뛴 것도 **사실대로** 알린다(민감정보라 안 보냈다는 것을 사람이 알아야 한다).
  if (r.skipped) return { error: r.reason };
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
  if ((input.body?.length ?? 0) > 8000) return { error: "본문은 메뉴 참조를 포함해 8,000자까지 입력해 주세요" };

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
  if (error) return { error: humanizeDbError(error.message, "저장") };

  // 생성·삭제만 남기고 **수정은 빠져 있었다**(2026-08-27 점검) — 팝업은 전 직원·학부모가 보는 글이라
  // 내용이 언제 누구 손에 바뀌었는지가 남아야 한다.
  await logAction({
    action: "notice_popup_update",
    targetType: "notice_popup",
    targetLabel: input.title,
  });

  invalidate(g.user.tenantId);
  queueTranslation(input.id, input, g.user.tenantId);
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
  const { data, error } = await supabase
    .from("notice_popups")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("tenant_id", g.user.tenantId)
    .select("title")
    .maybeSingle();
  if (error) return { error: humanizeDbError(error.message, "변경") };

  await logAction({
    action: "notice_popup_toggle",
    targetType: "notice_popup",
    targetLabel: (data?.title as string | undefined) ?? "팝업 공지",
    metadata: { active: isActive },
  });

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
  if (error) return { error: humanizeDbError(error.message, "삭제") };

  await logAction({
    action: "notice_popup_delete",
    targetType: "notice_popup",
    targetLabel: (popup?.title as string | undefined) ?? id,
  });
  invalidate(g.user.tenantId);
  return { ok: true };
}
