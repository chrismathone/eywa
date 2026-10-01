import { after, NextResponse } from "next/server";
import { completeLinkUpload } from "@/features/video-submit/server/upload-complete";
import { afterLinkUpload } from "@/features/video-submit/server/upload-notify";

/**
 * 공개 제출 링크 — 업로드가 끝났다는 알림. 서버가 Drive를 다시 읽어 확인한 뒤에만 영상 줄을 만든다
 * (`completeLinkUpload`). 새 줄이 생겼을 때만 응답 뒤 감사로그·담임 벨.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { token?: unknown; uploadId?: unknown } | null;
  const result = await completeLinkUpload({ token: body?.token, uploadId: body?.uploadId });
  if (result.ok && result.created) {
    const { tenantId, studentId, route, videoId, bytes } = result;
    after(() => afterLinkUpload({ tenantId, studentId, route, videoId, bytes }));
  }
  // 학부모 화면엔 성공 여부·한글 사유만(지점·학생·폴더 정보는 돌려주지 않는다).
  const payload = result.ok ? { ok: true } : { ok: false, code: result.code, error: result.error };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}
