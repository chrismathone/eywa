import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { isImageAttachment } from "@/features/onescreen/attachment-utils";

/**
 * ClassNote 발송 워커 전용 — 리포트 첨부의 signed 다운로드 URL 반환.
 * Phase 2 네이티브 첨부(attached_files/attached_images)에서 워커가 원본 바이트를 kage로 재업로드하려면
 * 원본이 필요한데, 워커에 스토리지 자격증명·백엔드 분기를 넣는 대신 **앱 서명(resolveTenantReadUrls)을 재사용**한다.
 * ⚠️ `x-eywa-internal` === `CLASSNOTE_INTERNAL_SECRET` 게이트(/r 워커 스샷과 동일 시크릿).
 *
 * 반환: `{ files, images }` — files=비이미지(첨부파일, `attached_files`), images=이미지(교재 등, `attached_images`에
 * 스샷과 함께 개별 부착). ⚠️ **하위호환**: `images`는 2026-07-22 신설 — 구 워커는 이 필드를 안 읽어 무해하다
 * (재이관 전까지 이미지는 스샷에만 실림, 종전과 동일). 이미지 개별 부착 결정 배경 = 원장 김경민 건 제보.
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const secret = process.env.CLASSNOTE_INTERNAL_SECRET;
  if (!secret || request.headers.get("x-eywa-internal") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { reportId } = await params;

  const admin = createAdminClient();
  const { data: report } = await admin
    .from("lesson_reports")
    .select("tenant_id, attachments")
    .eq("id", reportId)
    .maybeSingle();
  if (!report) return NextResponse.json({ files: [], images: [] });

  const attachments = (report.attachments as { path: string; name: string }[] | null) ?? [];
  const files = attachments.filter((a) => !isImageAttachment(a.name || a.path)); // 비이미지 → attached_files
  const images = attachments.filter((a) => isImageAttachment(a.name || a.path)); // 이미지 → attached_images 개별 부착
  if (!files.length && !images.length) return NextResponse.json({ files: [], images: [] });

  // 한 번에 서명(파일+이미지) — path→URL 맵. 실패는 빈 맵으로 폴백(개별 filter가 URL 없는 건 제거).
  const urls = await resolveTenantReadUrls(
    [...files, ...images].map((a) => a.path),
    "report_attachment",
    report.tenant_id as string,
  ).catch(() => ({}) as Record<string, string>);

  const toOut = (list: { path: string; name: string }[]) =>
    list.map((a) => ({ name: a.name, url: urls[a.path] })).filter((f) => f.url);
  return NextResponse.json({ files: toOut(files), images: toOut(images) });
}
