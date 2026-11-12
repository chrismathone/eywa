import { redirect } from "next/navigation";

import { kstMinutesOfDay } from "@/lib/date-kst";
import { parentPortalAvailable, parentPortalState } from "@/features/shuttle/parent/server/parent-availability";
import { getParentViewer } from "@/features/shuttle/parent/server/parent-viewer";
import { ParentPortalUnavailable } from "../_components/parent-portal-unavailable";
import { loadParentLiveData } from "@/features/shuttle/map/server/parent-live-data";
import { nearestLegKey } from "@/features/shuttle/map/parent-live";
import { ACADEMY_LOCATION } from "@/features/shuttle/map/academy-location";
import { ParentLiveView } from "./_components/parent-live-view";

export async function generateMetadata() {
  const viewer = await getParentViewer();
  return { title: viewer && (await parentPortalAvailable(viewer)) ? "실시간 차량" : "학부모" };
}

/** 빌드에 박히는 값 — 키가 없으면 지도 대신 안내만 그린다(지도 청크도 안 받는다). */
const KAKAO_MAP_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ?? "";

/**
 * 학부모 탭 1 '실시간 차량' — 우리 아이가 오늘 타는 회차의 **노선도 + 지도(정류장·도로 경로) + 탈 곳/내릴 곳**
 * (사용자 2026-10-08 지도 1단계 · 2026-10-15 회차 노선).
 *
 * 🔴 지어내지 않는다: 차량 위치를 보내는 기기(기사 폰 GPS)가 아직 없다 — 지도엔 계획된 길과 정류장만, 차는 "아직"이라고 말한다.
 * 🔑 지도의 기준은 **학원**(인재원 침산, `academy-location.ts`). 처음 띄울 회차는 지금과 가까운 구간(`nearestLegKey`).
 */
export default async function ParentLivePage() {
  const viewer = await getParentViewer();
  if (!viewer) redirect("/home");
  // 화면을 연 채로 기능이 꺼지면 탭 이동에 레이아웃이 다시 그려지지 않는다 — 빈 본문 대신 같은 종착 화면.
  const portal = await parentPortalState(viewer);
  if (portal !== "on") return <ParentPortalUnavailable state={portal} />;
  const { legs } = await loadParentLiveData(viewer);

  return (
    <>
      <h1 className="text-lg font-bold">실시간 차량</h1>
      <ParentLiveView
        appKey={KAKAO_MAP_KEY}
        academy={ACADEMY_LOCATION}
        legs={legs}
        initialKey={nearestLegKey(legs, kstMinutesOfDay(new Date()))}
      />
    </>
  );
}
