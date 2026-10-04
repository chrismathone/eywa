import { notFound } from "next/navigation";
import { NEUTRAL_ACADEMY_NAME } from "@/features/owner/defaults";
import { HOMEWORK_VIDEO_MAX_LABEL } from "@/features/students/homework-video-limits";
import { siteDirectory, type SiteDirectory } from "@/features/video-submit/server/site";
import { VideoSiteForm } from "./video-site-form";

// 학생이 로그인 없이 여는 공개 화면 — 색인 금지.
export const metadata = { title: "숙제 영상 올리기", robots: { index: false, follow: false }, referrer: "no-referrer" as const };
export const dynamic = "force-dynamic";

/**
 * 숙제 영상 **올리기 사이트**(`/v`, 0330a, 원장 2026-10-02) — ClassNote를 쓸 수 없는 학생이 주소 하나로 숙제 영상을 올린다.
 * 휴대폰 뒷 4자리 + 이름 → 선생님이 낸 영상 숙제(아직 안 낸 것) 고르기 → 그 학생 × 반의 제출 링크가 만들어져 기존 제출 화면
 * (`/v/<토큰>?h=숙제일`)으로 넘어간다(원장 2026-10-03 — 이름까지 넣어야 하고, 숙제가 있어야 올릴 수 있다).
 *  · 지점 = 숙제 영상 저장 폴더가 있는 지점(지점마다 따로, 2026-10-04). 🔑 주소는 하나다(지점을 주소에 넣지 않는다 — 멀티테넌트 C안):
 *    사이트를 쓰는 지점이 **하나면 그 지점으로 바로**(지금까지와 같은 화면), **여럿이면 화면에서 지점을 고른다**(자리 PIN과 같은 방식).
 *    목록엔 지금 실제로 쓸 수 있는 지점만 선다 — 꺼진 지점은 이름도 내보내지 않는다. 판정하지 못한 지점이 있으면 하나여도 고르게 한다.
 *  · 사이트를 쓰는 지점이 하나도 없으면(저장 폴더 없음·ClassNote 기능 꺼짐) → 없는 주소(404). 기능 스위치 OFF는 흔적 없이.
 *  · SQL(0330a)·워커 기록이 아직이거나 순간 오류 → "지금은 받을 수 없습니다".
 * 여기서는 학생 정보를 하나도 읽지 않는다 — 조회는 입력 뒤 라우트(`/api/video-submit/site`)가 횟수 제한을 걸고 한다.
 */
export default async function VideoSitePage() {
  let directory: SiteDirectory;
  try {
    directory = await siteDirectory();
  } catch {
    directory = { ok: false, reason: "unavailable" };
  }
  if (!directory.ok && directory.reason === "none") notFound();
  if (!directory.ok)
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 px-6 pb-8 text-center lg:pb-10">
        <p className="text-foreground text-lg font-bold">지금은 영상을 받을 수 없습니다</p>
        <p className="text-text-dim text-sm break-keep">잠시 후 다시 열어 주시거나 담당 선생님께 알려 주세요.</p>
      </div>
    );
  // 쓸 수 있는 지점이 하나뿐이고 판정하지 못한 지점도 없으면 고를 것이 없다 — 화면은 지금까지와 같고, 요청은 **그 지점에 고정**해 보낸다
  // (나중에 그 지점이 꺼지고 다른 지점만 남아도 이 화면이 그 지점으로 옮겨 가지 않게).
  // 🔴 판정하지 못한 지점이 있으면(잠시 못 받음·조회 오류) 하나만 남아도 자동으로 정하지 않고 고르게 한다 — 그 지점 학생일 수 있다.
  //    "지금은 받을 수 없습니다"로 닫지 않는 이유: 다른 지점 하나의 일시 장애로 멀쩡한 지점의 올리기까지 막히면 안 된다.
  const only = directory.sites.length === 1 && !directory.partial ? directory.sites[0]! : null;
  return (
    <VideoSiteForm
      academyName={only?.academyName ?? NEUTRAL_ACADEMY_NAME}
      branches={directory.sites.map((site) => ({ id: site.tenantId, name: site.branchName }))}
      mustChoose={!only}
      maxLabel={HOMEWORK_VIDEO_MAX_LABEL}
    />
  );
}
