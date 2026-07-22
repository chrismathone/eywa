import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { isImageAttachment } from "@/features/onescreen/attachment-utils";

/**
 * ClassNote 발송 워커 전용 — 리포트의 **파일 첨부(비이미지)** signed 다운로드 URL 반환.
 * Phase 2 네이티브 파일첨부(attached_files)에서 워커가 파일 바이트를 kage로 재업로드하려면 원본이 필요한데,
 * 워커에 스토리지 자격증명·백엔드 분기를 넣는 대신 **앱 서명(resolveTenantReadUrls)을 재사용**한다.
 * ⚠️ `x-eywa-internal` === `CLASSNOTE_INTERNAL_SECRET` 게이트(/r 워커 스샷과 동일 시크릿). 이미지 첨부는 스샷에 실리므로 제외.
 *
 * ⚠️ 이미지 개별 부착(`images` 필드)은 2026-07-22 시도했다가 철회 — ClassNote가 attached_images를 **가로로 나열**해
 *    세로 배치가 안 됐다(원장 확인). 대신 이미지는 /r 스샷 하단에 **크게** 실어 스샷 1장으로 세로 완결한다
 *    (visibleAttachments·ParentReportCard). 이 라우트는 파일(비이미지)만 반환 = 원래 계약.
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
  if (!report) return NextResponse.json({ files: [] });

  const attachments = (report.attachments as { path: string; name: string }[] | null) ?? [];
  const files = attachments.filter((a) => !isImageAttachment(a.name || a.path)); // 파일만(이미지는 스샷에 포함)
  if (!files.length) return NextResponse.json({ files: [] });

  const urls = await resolveTenantReadUrls(
    files.map((a) => a.path),
    "report_attachment",
    report.tenant_id as string,
  ).catch(() => ({}) as Record<string, string>);

  const out = files.map((a) => ({ name: a.name, url: urls[a.path] })).filter((f) => f.url);
  return NextResponse.json({ files: out });
}
