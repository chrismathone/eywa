import { redirect } from "next/navigation";

import { getParentViewer } from "@/features/shuttle/parent/server/parent-viewer";
import { loadNearbyNetwork } from "@/features/shuttle/parent/server/nearby-data";
import { ACADEMY_LOCATION } from "@/features/shuttle/map/academy-location";
import { NearbyView } from "./_components/nearby-view";

export const metadata = { title: "가까운 노선 찾기" };

/** 빌드에 박히는 값 — 키가 없으면 지도 대신 목록만 그린다. */
const KAKAO_MAP_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ?? "";

/**
 * 학부모 탭 4 '가까운 노선 찾기'(사용자 2026-10-22) — 장소(검색·내 위치)를 주면 **걸어서** 가까운 정류장 5곳과
 * 그곳을 지나는 **몇 호차 몇 회차 몇 시** 노선을 보여 준다(2026-10-26 다시 설계 — 시간 입력 없음). 판정은 순수 `nearby.ts`, 노선망은 서버가 한 번 싣는다(정류장 좌표 + 회차 시각만).
 */
export default async function ParentNearbyPage() {
  const viewer = await getParentViewer();
  if (!viewer) redirect("/home");
  const { stops, runs } = await loadNearbyNetwork(viewer.tenantId);
  return (
    <>
      <h1 className="text-lg font-bold">가까운 노선 찾기</h1>
      <NearbyView appKey={KAKAO_MAP_KEY} academy={ACADEMY_LOCATION} stops={stops} runs={runs} />
    </>
  );
}
