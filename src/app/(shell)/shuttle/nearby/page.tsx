import { notFound } from "next/navigation";
import { FaceTabs } from "@/components/face-tabs";
import { ACADEMY_LOCATION } from "@/features/shuttle/map/academy-location";
import { SHUTTLE_NEARBY_PATH, shuttleFaces } from "@/features/shuttle/faces";
import { loadNearbyNetwork } from "@/features/shuttle/parent/server/nearby-data";
import { isShuttleAdmin, requireShuttleView } from "@/features/shuttle/server/access";
import { isSeason, type Season } from "@/features/shuttle/types";
import { loadNearbyStudents } from "@/features/shuttle/parent/server/staff-nearby";
import { StaffNearbyClient } from "./_components/staff-nearby-client";

export const metadata = { title: "가까운 노선 찾기 — aywa" };

/** 빌드에 박히는 값 — 키가 없으면 지도 대신 목록만 그린다. */
const KAKAO_MAP_KEY = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY ?? "";

/**
 * 셔틀 '가까운 노선 찾기'(사용자 2026-10-26 "관리자 계정에서 가까운 노선 찾기를 넣어서") — 학부모 탭 4와 **같은 화면**을
 * 관리자가 본다(상담 전화·신입 안내 때 "그 집이면 어느 정류장"을 바로 짚는다).
 * 🔒 실시간 위치와 같은 원장·관리자·총괄 전용(`isShuttleAdmin`, 밖은 404). 재료는 학부모 화면과 같은 노선망(학기중, 학생 정보 없음).
 * 🔑 왼쪽 = 재원생 학교별 목록(누르면 주소·학교 자리로 찾기), 내 위치 버튼은 없다(사용자 2026-10-26).
 * 🔑 화면 부품을 복제하지 않는다 — 학부모 `NearbyView` 그대로(두 화면의 순위가 갈리지 않게).
 */
export default async function ShuttleNearbyPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const user = await requireShuttleView();
  if (!(await isShuttleAdmin())) notFound();
  const sp = await searchParams;
  const season: Season = isSeason(sp.season) ? sp.season : "term";
  // 서로 독립 — 함께 받는다(B4).
  const [{ stops, runs }, { students, error }] = await Promise.all([loadNearbyNetwork(user.tenantId), loadNearbyStudents(user.tenantId)]);
  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      <FaceTabs faces={shuttleFaces(season, { track: true })} active={SHUTTLE_NEARBY_PATH} ariaLabel="셔틀 면 전환" />
      <StaffNearbyClient
        appKey={KAKAO_MAP_KEY}
        academy={ACADEMY_LOCATION}
        stops={stops}
        runs={runs}
        students={students}
        studentsError={error}
      />
    </div>
  );
}
