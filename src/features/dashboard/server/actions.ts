"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { reportError } from "@/lib/observability/report-error";
import { logAction } from "@/features/audit/server/log";
import { normalizeNoticeAudience } from "@/features/notices/audience";
import { generateDailyBriefing } from "./briefing";
import { DAILY_BRIEFING_DISABLED_MESSAGE, DAILY_BRIEFING_ENABLED } from "../briefing-status";
import { explainDbError } from "@/lib/supabase/db-error";

export type AnnouncementActionState = { error?: string; ok?: boolean } | undefined;

// 🔑 행위자 = '다른 강사 뷰'의 대상 직원(`getCurrentUser({ teacherView: true })`) — 직원 관리 역할 판정(canManageStaff)과 공지 작성자(author_id)가
//    대상 기준이다. 로그인 계정 역할로 열면 대상 직원이 못 하는 공지 작성·브리핑 재생성이 그 화면에서 열린다(원장 2026-11-05 강사뷰 전수).
//    '읽기' 강사뷰는 canWriteTenant가 막는다. 감사로그 행위자는 로그인 계정 그대로(logAction).

function revalidateDashboard() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/announcements");
  revalidatePath("/dashboard/briefing");
}

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
  const user = await getCurrentUser({ teacherView: true });
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
  if (error) return { error: explainDbError(error, { scope: "dashboard.actions.createAnnouncement", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  // 직원 공지는 전 직원이 보는 글이라 "누가 이 문구를 올렸나"가 역검수 대상이다(원장 2026-09-09).
  // ⚠️ 본문(content)은 싣지 않는다 — 감사로그는 '누가·언제·무엇을'이지 글 보관소가 아니다(제목으로 찾는다).
  await logAction({
    action: "announcement_create",
    targetType: "announcement",
    targetLabel: input.title,
    metadata: { audience: input.audience, pinned: input.pinned },
  });

  revalidateDashboard();
  return { ok: true };
}

export async function updateAnnouncement(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const user = await getCurrentUser({ teacherView: true });
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
  if (error) return { error: explainDbError(error, { scope: "dashboard.actions.updateAnnouncement", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  await logAction({
    action: "announcement_update",
    targetType: "announcement",
    targetLabel: input.title,
    metadata: { announcementId: input.id, audience: input.audience, pinned: input.pinned },
  });

  revalidateDashboard();
  return { ok: true };
}

export async function deleteAnnouncement(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "dashboard"))) {
    return { error: "공지 삭제 권한이 없습니다" };
  }

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "공지 ID가 누락되었습니다" };

  const supabase = await createClient();
  // 🔴 제목은 지우기 **전에** 읽는다 — 지운 뒤엔 읽을 곳이 없어 감사로그가 uuid만 남은 "—" 줄이 된다
  //    (지운 글일수록 "무엇을 지웠나"가 역검수의 핵심이다). 실패해도 삭제는 진행한다(best-effort).
  const { data: before } = await supabase
    .from("announcements")
    .select("title, audience, pinned")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("announcements").delete().eq("id", id);
  if (error) return { error: explainDbError(error, { scope: "dashboard.actions.deleteAnnouncement", fallback: "삭제하지 못했습니다 — 잠시 후 다시 시도해 주세요", op: "delete" }).message };

  await logAction({
    action: "announcement_delete",
    targetType: "announcement",
    targetLabel: (before?.title as string | null) ?? null,
    metadata: {
      announcementId: id,
      audience: (before?.audience as string | null) ?? null,
      pinned: (before?.pinned as boolean | null) ?? null,
    },
  });

  revalidateDashboard();
  return { ok: true };
}

/**
 * 일일 브리핑 '다시 생성' — 유일한 사용자 트리거 AI 호출(유료 호출 통제: 카드 노출과 동일한
 * master/admin/manager + dashboard write 게이트). enrollment 재분석 패턴 복제:
 * 원자 claim(analyzing 선점, updated_at 5분 stuck 우회) → after() 백그라운드 → 클라 5초 폴링 갱신.
 * 재생성은 벨 알림을 다시 쏘지 않는다(notified_at 게이트는 최초 생성 전용).
 */
export async function regenerateDailyBriefing(): Promise<{ error?: string; ok?: boolean }> {
  if (!DAILY_BRIEFING_ENABLED) return { error: DAILY_BRIEFING_DISABLED_MESSAGE };
  const user = await getCurrentUser({ teacherView: true });
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
  // UI raw 에러 원문 노출 금지 — DB 원문은 로그로만, 화면엔 한글 안내(classnote-error.ts 선례).
  if (readError) {
    reportError(readError, { scope: "briefing.regen.read", tenantId });
    return { error: "브리핑 상태 확인에 실패했습니다. 잠시 후 다시 시도해 주세요." };
  }

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
    if (claimError) {
      reportError(claimError, { scope: "briefing.regen.claim", tenantId });
      return { error: "브리핑 생성을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
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
      if (insertError.code === "23505") {
        return { error: "이미 생성이 진행 중입니다. 완료되면 화면이 자동으로 갱신됩니다." };
      }
      reportError(insertError, { scope: "briefing.regen.insert", tenantId });
      return { error: "브리핑 생성을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." };
    }
  }

  // 유료 AI 호출을 사람이 눌러 다시 태우는 경로 — 회의 재분석·AI 케어 분석과 같은 결로 남긴다(비용 역검수).
  // 🔴 claim이 성공한 뒤에만 남긴다: 위 "이미 생성 중" 반환은 **아무것도 쓰지 않은** 경로라 로그 대상이 아니다
  //    (남기면 연타 한 번에 같은 줄이 여러 개 쌓여 정작 진짜 실행이 묻힌다).
  await logAction({
    action: "briefing_regenerate",
    targetType: "briefing",
    targetLabel: date,
    metadata: { briefingDate: date, hadPrevious: Boolean(existing) },
  });

  revalidateDashboard();
  after(async () => {
    await generateDailyBriefing(tenantId);
  });
  return { ok: true };
}

export async function toggleAnnouncementPin(
  _prev: AnnouncementActionState,
  formData: FormData,
): Promise<AnnouncementActionState> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!canManageStaff(user.systemRole) || !(await canWriteTenant(user.systemRole, "dashboard"))) {
    return { error: "권한이 없습니다" };
  }

  const id = String(formData.get("id") ?? "").trim();
  const pinned = formData.get("pinned") === "true";
  if (!id) return { error: "공지 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("announcements")
    .select("title")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("announcements")
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: explainDbError(error, { scope: "dashboard.actions.toggleAnnouncementPin", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  await logAction({
    action: "announcement_pin",
    targetType: "announcement",
    targetLabel: (before?.title as string | null) ?? null,
    metadata: { announcementId: id, pinned },
  });

  revalidateDashboard();
  return { ok: true };
}
