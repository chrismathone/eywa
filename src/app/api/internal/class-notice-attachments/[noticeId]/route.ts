import { secretMatches } from "@/lib/http/secret-compare";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveTenantReadUrls } from "@/lib/storage/media-storage";
import { classNoticeAttachmentsOf } from "@/features/report-admin/class-notice";

/**
 * ClassNote 연동 PC 워커 전용 — **반 공지**(classnote_class_notices)에 붙인 이미지의 서명 다운로드 주소.
 * 원생 개별 공지의 [`notice-attachments`](../../notice-attachments/[noticeId]/route.ts)와 같은 구조다(앱의 서명을 재사용 —
 * 워커에 스토리지 자격증명을 넣지 않는다). 반 공지의 이미지는 **전 반 공통**이라 목록은 하나다.
 *
 * 🔴 `expected`(서명 전 장수)·`missing`(서명에 실패한 이름)을 함께 준다 — 서명 실패분을 그냥 빼고 주면 워커가
 *    "원래 몇 장이었는지" 알 길이 없어 이미지가 빠진 공지를 올리고 '발송 완료'로 적는다. 워커는 장수가 모자라면 올리지 않는다.
 * ⚠️ 게이트: `x-eywa-internal` === `CLASSNOTE_INTERNAL_SECRET`(보고서 첨부·개별 공지 첨부와 같은 시크릿).
 * ⚠️ 공지 행이 없으면 404 — 200 + 빈 목록으로 얼버무리면 워커가 글만 올린다.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ noticeId: string }> }) {
  const secret = process.env.CLASSNOTE_INTERNAL_SECRET;
  if (!secretMatches(request.headers.get("x-eywa-internal"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { noticeId } = await params;

  const admin = createAdminClient();
  const { data: notice } = await admin
    .from("classnote_class_notices")
    .select("tenant_id, targets")
    .eq("id", noticeId)
    .maybeSingle();
  if (!notice) return NextResponse.json({ error: "notice_not_found" }, { status: 404 });

  const list = classNoticeAttachmentsOf(notice.targets);
  let urls: Record<string, string> = {};
  try {
    urls = await resolveTenantReadUrls(list.map((a) => a.path), "report_attachment", notice.tenant_id as string);
  } catch {
    // 전건 실패 — 삼키면 "이미지 0장"으로 보여 글만 나간다. 500으로 떨어뜨려 워커가 사유를 남기게 한다.
    return NextResponse.json({ error: "sign_failed" }, { status: 500 });
  }
  const images: { name: string; url: string }[] = [];
  const missing: string[] = [];
  for (const a of list) {
    const url = urls[a.path];
    if (url) images.push({ name: a.name, url });
    else missing.push(a.name || "이미지");
  }
  return NextResponse.json({ images, expected: list.length, missing });
}
