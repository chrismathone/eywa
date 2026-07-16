import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { isImageAttachment } from "@/features/onescreen/attachment-utils";

/**
 * ClassNote 발송 워커 전용 — 리포트의 **파일 첨부(비이미지)** signed 다운로드 URL 반환.
 * Phase 2 네이티브 파일첨부(attached_files)에서 워커가 파일 바이트를 kage로 재업로드하려면 원본이 필요한데,
 * 워커에 스토리지 자격증명·백엔드 분기를 넣는 대신 **앱 서명(resolveTenantReadUrls)을 재사용**한다.
 * ⚠️ `x-eywa-internal` === `CLASSNOTE_INTERNAL_SECRET` 게이트(/r 워커 스샷과 동일 시크릿). 이미지 첨부는 스샷에 실리므로 제외.
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
