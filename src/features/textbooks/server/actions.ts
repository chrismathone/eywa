"use server";

/**
 * 교재목록 쓰기 — 교재 등록/수정/폐지 + 차수 표 저장.
 *
 * 🔴 모든 액션이 첫 줄에서 [`requireTextbookWrite`](./access.ts)를 지난다([[#77]] — 화면 조건은 게이트가 아니다).
 * 🔴 admin 클라이언트(RLS 우회)라 **모든 쿼리에 `tenant_id` 명시 필터**.
 * ⚠️ `"use server"` 파일은 async 함수만 export할 수 있다([[#119]]) — 동기 헬퍼는 여기 두지 말 것.
 */
import { revalidatePath, updateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { logAction } from "@/features/audit/server/log";
import { friendlyTextbookError, requireTextbookWrite } from "./access";
import { getTextbookDetail, textbookOptionsTag } from "./queries";
import type { TextbookDetail, TextbookTableStatus } from "../types";

export type TextbookActionResult = { ok: true; id: string } | { ok: false; error: string };
export type TextbookSaveResult = { ok: true } | { ok: false; error: string };

const MAX_SESSION_COUNT = 200;
const MAX_TEXT = 500;

/** 저장 전 정규화 — trim, 빈 문자열은 null(ECS `normalizePlanText`와 같은 규약). */
function norm(v: string | null | undefined, max: number): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (t === "") return null;
  return t.slice(0, max);
}

export type TextbookInput = {
  id?: string | null;
  subject: string;
  skillArea: string | null;
  title: string;
  pageTime: string | null;
  sessionCount: number;
};

export async function saveTextbook(input: TextbookInput): Promise<TextbookActionResult> {
  const ctx = await requireTextbookWrite();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const title = norm(input.title, 120);
  if (!title) return { ok: false, error: "교재이름을 입력하세요" };
  const subject = norm(input.subject, 24) ?? "english";
  const skillArea = norm(input.skillArea, 24);
  if (skillArea !== null && !/^[a-z0-9_]{1,24}$/.test(skillArea)) {
    return { ok: false, error: "구분 값이 올바르지 않습니다" };
  }
  const sessionCount = Number.isFinite(input.sessionCount)
    ? Math.max(0, Math.min(MAX_SESSION_COUNT, Math.trunc(input.sessionCount)))
    : 0;

  const admin = createAdminClient();
  const payload = {
    subject,
    skill_area: skillArea,
    title,
    page_time: norm(input.pageTime, 40),
    session_count: sessionCount,
    updated_by: ctx.userId,
  };

  if (input.id) {
    const { error } = await admin
      .from("textbooks")
      .update(payload)
      .eq("tenant_id", ctx.tenantId)
      .eq("id", input.id);
    if (error) return { ok: false, error: friendlyTextbookError(error, "교재를 수정하지 못했습니다") };
    await logAction({ action: "textbook_update", targetType: "textbook", targetLabel: title, metadata: { id: input.id } });
    await afterWrite(ctx.tenantId);
    return { ok: true, id: input.id };
  }

  const { data, error } = await admin
    .from("textbooks")
    .insert({ ...payload, tenant_id: ctx.tenantId, created_by: ctx.userId })
    .select("id")
    .single();
  if (error || !data) {
    return {
      ok: false,
      error: friendlyTextbookError(
        error ?? {},
        "교재를 등록하지 못했습니다",
        "이미 같은 이름의 교재가 있습니다 — 폐지된 교재라면 '폐지 포함'을 켜고 되살리세요",
      ),
    };
  }
  await logAction({ action: "textbook_create", targetType: "textbook", targetLabel: title, metadata: { id: data.id } });
  await afterWrite(ctx.tenantId);
  return { ok: true, id: data.id as string };
}

/**
 * 폐지/되살리기 — 🔴 **지우지 않는다**(교재 단가표 0193a 선례). 목록에서는 사라지지만 되돌릴 수 있고,
 * 이미 시트에 적힌 교재명은 자유 텍스트라 어차피 그대로 남는다.
 */
export async function setTextbookActive(id: string, active: boolean): Promise<TextbookSaveResult> {
  const ctx = await requireTextbookWrite();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const { error } = await createAdminClient()
    .from("textbooks")
    .update({ is_active: active, updated_by: ctx.userId })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id);
  if (error) return { ok: false, error: friendlyTextbookError(error, "상태를 바꾸지 못했습니다") };
  await logAction({
    action: active ? "textbook_restore" : "textbook_retire",
    targetType: "textbook",
    metadata: { id },
  });
  await afterWrite(ctx.tenantId);
  return { ok: true };
}

export type LessonPatch = { lessonNo: number; progress: string | null; homework: string | null };

/**
 * 차수 표 저장 — 바뀐 칸만 넘어온다.
 *
 * 🔑 **둘 다 빈 차수는 행을 지운다**(`body: null`이 행 삭제인 MP 규약과 같은 결) — 빈 행을 쌓아 두면
 *    "진도·과제가 적힌 차수 수"가 거짓이 되고, 기입 때 아무것도 안 들어가는 칸이 대상으로 잡힌다.
 */
export async function saveTextbookLessons(
  textbookId: string,
  patches: LessonPatch[],
): Promise<TextbookSaveResult> {
  const ctx = await requireTextbookWrite();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!Array.isArray(patches) || patches.length === 0) return { ok: true };
  if (patches.length > MAX_SESSION_COUNT) return { ok: false, error: "한 번에 저장할 수 있는 차수를 넘었습니다" };

  const admin = createAdminClient();
  // 소유 확인 — 남의 테넌트 교재 id를 넘겨도 아무 일이 없게.
  const { data: owner, error: ownerErr } = await admin
    .from("textbooks")
    .select("id, title")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", textbookId)
    .maybeSingle();
  if (ownerErr) return { ok: false, error: friendlyTextbookError(ownerErr, "교재를 찾지 못했습니다") };
  if (!owner) return { ok: false, error: "교재를 찾을 수 없습니다" };

  const clean = patches
    .map((p) => ({
      lessonNo: Math.trunc(Number(p.lessonNo)),
      progress: norm(p.progress, MAX_TEXT),
      homework: norm(p.homework, MAX_TEXT),
    }))
    .filter((p) => Number.isFinite(p.lessonNo) && p.lessonNo >= 1 && p.lessonNo <= MAX_SESSION_COUNT);

  const empties = clean.filter((p) => p.progress === null && p.homework === null).map((p) => p.lessonNo);
  const upserts = clean.filter((p) => p.progress !== null || p.homework !== null);

  if (empties.length > 0) {
    const { error } = await admin
      .from("textbook_lessons")
      .delete()
      .eq("tenant_id", ctx.tenantId)
      .eq("textbook_id", textbookId)
      .in("lesson_no", empties);
    if (error) return { ok: false, error: friendlyTextbookError(error, "차수를 비우지 못했습니다") };
  }
  if (upserts.length > 0) {
    const { error } = await admin.from("textbook_lessons").upsert(
      upserts.map((p) => ({
        tenant_id: ctx.tenantId,
        textbook_id: textbookId,
        lesson_no: p.lessonNo,
        progress: p.progress,
        homework: p.homework,
        updated_by: ctx.userId,
      })),
      // 🔴 일반 유니크라서 추론된다 — 부분 유니크였다면 42P10으로 전건 실패했을 자리([[#113]]).
      { onConflict: "tenant_id,textbook_id,lesson_no" },
    );
    if (error) return { ok: false, error: friendlyTextbookError(error, "차수를 저장하지 못했습니다") };
  }

  await logAction({
    action: "textbook_lessons_save",
    targetType: "textbook",
    targetLabel: owner.title as string,
    metadata: { id: textbookId, saved: upserts.length, cleared: empties.length },
  });
  revalidatePath("/textbooks");
  return { ok: true };
}

/** 목록·제안 캐시 무효화 — 저장 직후 화면과 ECS 제안이 같은 값을 보게(read-your-writes). */
async function afterWrite(tenantId: string): Promise<void> {
  updateTag(textbookOptionsTag(tenantId));
  revalidatePath("/textbooks");
}

/**
 * 교재 상세(차수 표 포함)를 **클라 다이얼로그가 열릴 때** 받아 간다 — 목록 전건의 차수를 미리 내려보내면
 * 교재 50개 × 차수 200개가 한 번에 실린다(B2·첫 페인트).
 *
 * 🔴 **읽기 게이트는 메뉴 접근**(`canAccessTenant`)이다 — 쓰기 게이트(`requireTextbookWrite`)를 쓰면
 *    "고르기만" 하는 강사(readonly)가 차수 표를 못 본다. 편집 가능 여부는 호출부가 따로 받는다([[#77]]에
 *    어긋나지 않는다 — 저장은 여전히 쓰기 게이트를 지난다).
 */
export async function loadTextbookDetail(
  id: string,
): Promise<{ ok: true; status: TextbookTableStatus; detail: TextbookDetail | null } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canAccessTenant(user.systemRole, "textbooks"))) return { ok: false, error: "접근 권한이 없습니다" };
  const res = await getTextbookDetail(id);
  return { ok: true, ...res };
}
