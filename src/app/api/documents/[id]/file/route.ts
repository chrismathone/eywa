import { apiAccess } from "@/lib/auth/api-access";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { signDocumentUrl } from "@/features/documents/server/actions";

/** 실제 파일명을 응답 헤더에 실어 다운로드·PDF 뷰어 모두 저장 객체 이름을 쓰지 않게 한다. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await apiAccess("documents");
  if (!gate.ok) return Response.json({ error: "문서를 열 권한이 없습니다." }, { status: gate.status });
  const { id } = await params;
  // 기존 서명 경로가 RLS·직원 전용 문서 제외·저장 경로의 학원을 함께 검증한다.
  const signed = await signDocumentUrl(id, "view");
  if (!signed.url || !signed.fileName) {
    return Response.json({ error: signed.error ?? "파일을 찾을 수 없습니다." }, { status: 404 });
  }
  try {
    const file = await fetch(signed.url, { cache: "no-store", signal: request.signal });
    if (!file.ok || !file.body) throw new Error("File unavailable");
    const type = file.headers.get("content-type") ?? "application/octet-stream";
    // HTML·SVG 등 실행 가능한 파일은 앱 출처에서 인라인으로 열지 않는다.
    const canPreview = /^(application\/pdf|image\/(png|jpeg|gif|webp|avif|bmp))(;|$)/i.test(type);
    const download = new URL(request.url).searchParams.get("download") === "1" || !canPreview;
    const disposition = attachmentFilename(signed.fileName);
    return new Response(file.body, {
      headers: {
        "Content-Type": type,
        "Content-Disposition": download ? disposition : disposition.replace(/^attachment;/, "inline;"),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "파일을 내려받지 못했습니다. 다시 시도해 주세요." }, { status: 502 });
  }
}
