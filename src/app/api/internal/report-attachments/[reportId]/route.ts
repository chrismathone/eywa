import { authorizeInternalWorker } from "@/features/sync-agent/server/internal-auth";
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
  const worker = await authorizeInternalWorker(request.headers.get("x-eywa-internal"));
  if (!worker) {
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
  if (worker.tenantId && report.tenant_id !== worker.tenantId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const attachments = (report.attachments as { path: string; name: string }[] | null) ?? [];
  const files = attachments.filter((a) => !isImageAttachment(a.name || a.path)); // 파일만(이미지는 스샷에 포함)
  if (!files.length) return NextResponse.json({ files: [] });

  // ⚠️ 학원설정 showAttachments는 **여기서 재검사하지 않는다**(형제 notice-attachments와 동일 규약).
  // 2026-07-22 전수검사에서 "여기가 유일한 초크포인트"라며 게이트를 넣었다가 되돌렸다 — 두 가지가 틀렸다:
  //  ① 게이트는 이미 있다. 워커가 이 설정을 **Postgres에서 직접** 읽고(classnote-core.mjs `isShowAttachmentsEnabled`)
  //     `if (showAttachments && fileAtts.length && boardId)`로 이 경로 진입 자체를 막는다. 앱이 전달할 필요가 없다.
  //     (당시 grep을 `src/features/report-admin/`으로만 돌려 워커 파일을 놓쳤다.)
  //  ② 여기서 빈 목록을 주면 **더 나쁘다**. 워커는 이 경로에 들어온 이상 빈 목록을 서명 실패로 보고
  //     `ok:false` → retry+1 → 3회째 `failed`로 떨군다. 첨부만 빠지는 게 아니라 **본문까지 발송이 통째로 막히고**,
  //     원인은 "스토리지 서명 실패"로 거짓 기록된다(원장이 폴 진행 중 토글을 끄면 그 배치가 전멸).
  // 읽기 시점에 조용히 빼지 말 것 — 게이트는 발송 시점 한 곳(#77).

  const urls = await resolveTenantReadUrls(
    files.map((a) => a.path),
    "report_attachment",
    report.tenant_id as string,
  ).catch(() => ({}) as Record<string, string>);

  const out = files.map((a) => ({ name: a.name, url: urls[a.path] })).filter((f) => f.url);
  return NextResponse.json({ files: out });
}
