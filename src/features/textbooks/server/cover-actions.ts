"use server";

/**
 * 교재 표지 사진 — 업로드 티켓 발급 → 클라 업로드 → 등록(검증) → 교체/삭제.
 *
 * 흐름은 지출 영수증·보고서 첨부와 **같은 규약**이다: 서버가 경로를 빌드하고(클라 입력 불신),
 * 등록 때 **객체가 실제로 올라왔는지 다시 확인**한다(티켓만 받고 register만 부르는 우회 차단).
 * 실패 경로에서는 올라간 객체를 서버가 지운다(클라에는 삭제 권한이 없다).
 */
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MEDIA_KIND,
  createUploadTicket,
  removeObject,
  verifyUploadedObject,
} from "@/lib/storage/media-storage";
import { isTenantTextbookCoverPath } from "@/lib/storage/legacy-audio-path";
import type { UploadTicket } from "@/lib/storage/types";
import { logAction } from "@/features/audit/server/log";
import { friendlyTextbookError, requireTextbookWrite } from "./access";

const COVER_BUCKET = MEDIA_KIND.textbook_cover.supabaseBucket;

export type CoverTicketResult = { ok: true; ticket: UploadTicket } | { ok: false; error: string };
export type CoverResult = { ok: true; path: string | null } | { ok: false; error: string };

export async function issueTextbookCoverTicket(input: {
  textbookId: string;
  contentType: string;
  size: number;
  ext: string;
}): Promise<CoverTicketResult> {
  const ctx = await requireTextbookWrite();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const meta = MEDIA_KIND.textbook_cover;
  if (!meta.allowCT(input.contentType)) return { ok: false, error: "JPG·PNG·WEBP 사진만 올릴 수 있습니다" };
  if (!Number.isFinite(input.size) || input.size <= 0 || input.size > meta.maxBytes) {
    return { ok: false, error: "사진이 너무 큽니다 (최대 5MB)" };
  }

  // 교재 소유 확인 — 남의 테넌트 id로 경로를 만들지 못하게.
  const { data: owner, error } = await createAdminClient()
    .from("textbooks")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.textbookId)
    .maybeSingle();
  if (error) return { ok: false, error: friendlyTextbookError(error, "교재를 찾지 못했습니다") };
  if (!owner) return { ok: false, error: "먼저 교재를 저장하세요" };

  const ext = input.ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `${ctx.tenantId}/textbooks/${randomUUID()}.${ext}`;
  if (!isTenantTextbookCoverPath(path, ctx.tenantId)) return { ok: false, error: "경로 생성 실패" };

  try {
    return { ok: true, ticket: await createUploadTicket({ kind: "textbook_cover", path, contentType: input.contentType }) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    // 🔴 버킷 생성(`scripts/setup-storage.ts`)은 마이그레이션처럼 **손으로 한 번** 돌리는 단계다.
    //    안 돌렸을 때 Supabase가 주는 `Bucket not found`가 그대로 나가면 화면에 영문 원문이 뜬다(raw 노출 금지).
    if (/bucket not found/i.test(msg)) {
      return { ok: false, error: "표지 보관함이 아직 준비되지 않았습니다 — 관리자에게 setup-storage 실행을 요청해 주세요" };
    }
    return { ok: false, error: msg || "업로드 준비에 실패했습니다" };
  }
}

export async function registerTextbookCover(input: { textbookId: string; path: string }): Promise<CoverResult> {
  const ctx = await requireTextbookWrite();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!isTenantTextbookCoverPath(input.path, ctx.tenantId)) {
    return { ok: false, error: "파일 경로가 잘못되었습니다" };
  }

  try {
    await verifyUploadedObject("textbook_cover", input.path);
  } catch (e) {
    await removeObject(input.path, { bucket: COVER_BUCKET }).catch(() => {});
    return { ok: false, error: e instanceof Error ? e.message : "업로드를 확인하지 못했습니다" };
  }

  const admin = createAdminClient();
  const { data: before } = await admin
    .from("textbooks")
    .select("cover_path, title")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.textbookId)
    .maybeSingle();
  // 🔴 없는(또는 남의 테넌트) 교재면 update가 **0행이라 에러 없이 성공**한다 — 올라간 파일만 버킷에
  //    고아로 남는다. 여기서 끊고 지운다(실패 경로에서 객체를 지우는 건 서버 몫이다).
  if (!before) {
    await removeObject(input.path, { bucket: COVER_BUCKET }).catch(() => {});
    return { ok: false, error: "교재를 찾을 수 없습니다" };
  }

  const { error } = await admin
    .from("textbooks")
    .update({ cover_path: input.path, updated_by: ctx.userId })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.textbookId);
  if (error) {
    await removeObject(input.path, { bucket: COVER_BUCKET }).catch(() => {});
    return { ok: false, error: friendlyTextbookError(error, "표지를 저장하지 못했습니다") };
  }

  // 교체면 옛 사진을 지운다(best-effort) — 안 지우면 버킷에 고아가 쌓인다.
  const old = (before?.cover_path as string | null) ?? null;
  if (old && old !== input.path) await removeObject(old, { bucket: COVER_BUCKET }).catch(() => {});

  // 🔴 감사로그에 **경로는 남기지 않는다**(영수증 첨부와 같은 규약).
  await logAction({
    action: "textbook_cover_set",
    targetType: "textbook",
    targetLabel: (before?.title as string | undefined) ?? null,
    metadata: { id: input.textbookId, replaced: Boolean(old) },
  });
  revalidatePath("/textbooks");
  return { ok: true, path: input.path };
}

export async function removeTextbookCover(textbookId: string): Promise<CoverResult> {
  const ctx = await requireTextbookWrite();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const admin = createAdminClient();
  const { data: before } = await admin
    .from("textbooks")
    .select("cover_path, title")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", textbookId)
    .maybeSingle();

  const { error } = await admin
    .from("textbooks")
    .update({ cover_path: null, updated_by: ctx.userId })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", textbookId);
  if (error) return { ok: false, error: friendlyTextbookError(error, "표지를 지우지 못했습니다") };

  const old = (before?.cover_path as string | null) ?? null;
  if (old) await removeObject(old, { bucket: COVER_BUCKET }).catch(() => {});
  await logAction({
    action: "textbook_cover_clear",
    targetType: "textbook",
    targetLabel: (before?.title as string | undefined) ?? null,
    metadata: { id: textbookId },
  });
  revalidatePath("/textbooks");
  return { ok: true, path: null };
}
