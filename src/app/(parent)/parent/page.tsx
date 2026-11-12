import { redirect } from "next/navigation";

import { parentPortalState } from "@/features/shuttle/parent/server/parent-availability";
import { getParentViewer } from "@/features/shuttle/parent/server/parent-viewer";
import { ParentPortalUnavailable } from "./_components/parent-portal-unavailable";

/**
 * `/parent` — 학부모 첫 화면. 지금 내용이 있는 섹션은 탭 2 '변경·확인'(셔틀 등하원)뿐이라 그리로 보낸다.
 * 로그인 착지(`/home`)가 이 주소로 보내므로, 기본 섹션을 바꿀 땐 여기 한 줄만 고친다.
 */
export default async function ParentHome() {
  const viewer = await getParentViewer();
  if (!viewer) redirect("/home");
  // 레이아웃의 이름 없는 안내가 이 주소의 종착점이다. `/home`으로 돌리면 학부모 신원 판정과 순환한다.
  // 화면을 연 채로 기능이 꺼지면 탭 이동에 레이아웃이 다시 그려지지 않는다 — 빈 본문 대신 같은 종착 화면.
  const portal = await parentPortalState(viewer);
  if (portal !== "on") return <ParentPortalUnavailable state={portal} />;
  redirect("/parent/rides");
}
