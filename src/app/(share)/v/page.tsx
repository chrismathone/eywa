import { notFound } from "next/navigation";
import { NEUTRAL_ACADEMY_NAME } from "@/features/owner/defaults";
import { HOMEWORK_VIDEO_MAX_LABEL } from "@/features/students/homework-video-limits";
import { siteAvailability } from "@/features/video-submit/server/site";
import { VideoSiteForm } from "./video-site-form";

// 학생이 로그인 없이 여는 공개 화면 — 색인 금지.
export const metadata = { title: "숙제 영상 올리기", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

/**
 * 숙제 영상 **올리기 사이트**(`/v`, 0330a, 원장 2026-10-02) — ClassNote를 쓸 수 없는 학생이 주소 하나로 숙제 영상을 올린다.
 * 휴대폰 뒷 4자리 → 내 이름(가운데 가림)·반 고르기 → 그 학생 × 반의 제출 링크가 만들어져 기존 제출 화면(`/v/<토큰>`)으로 넘어간다.
 *  · 영상을 받을 지점이 없거나(Drive 값 없음) ClassNote 기능이 꺼진 학원 → 없는 주소(404). 기능 스위치 OFF는 흔적 없이.
 *  · Drive·SQL(0330a)이 아직이거나 순간 오류 → "지금은 받을 수 없습니다".
 * 여기서는 학생 정보를 하나도 읽지 않는다 — 조회는 입력 뒤 라우트(`/api/video-submit/site`)가 횟수 제한을 걸고 한다.
 */
export default async function VideoSitePage() {
  let site: Awaited<ReturnType<typeof siteAvailability>>;
  try {
    site = await siteAvailability();
  } catch {
    site = { ok: false, reason: "unavailable" };
  }
  if (!site.ok && site.reason === "none") notFound();
  if (!site.ok)
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 pb-8 text-center lg:pb-10">
        <p className="text-foreground text-lg font-bold">지금은 영상을 받을 수 없습니다</p>
        <p className="text-text-dim text-sm break-keep">잠시 후 다시 열어 주시거나 담당 선생님께 알려 주세요.</p>
      </div>
    );
  return <VideoSiteForm academyName={site.academyName ?? NEUTRAL_ACADEMY_NAME} maxLabel={HOMEWORK_VIDEO_MAX_LABEL} />;
}
