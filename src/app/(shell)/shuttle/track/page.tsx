import { kstToday } from "@/lib/date-kst";
import {
  getBoardingsOn,
  getRideExceptionsOn,
  getShuttleBoard,
  getTripsOn,
} from "@/features/shuttle/server/queries";
import { notFound } from "next/navigation";
import { isShuttleAdmin, requireShuttleView } from "@/features/shuttle/server/access";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { isSeason, type Season } from "@/features/shuttle/types";
import { TrackClient } from "./_components/track-client";

export const metadata = { title: "셔틀 실시간 위치 — 에이와" };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 실시간 위치 — 차량이 지도에 뜰 **자리**를 잡아 둔 화면.
 *
 * 원장(2026-09-03): *"운행현황 옆에 버튼하나 더해서 실시간 위치 만들어서 쓸수있게 해주고"* +
 * *"지도키는 추후 개발예정이라 잡고 **영역만 만들어두려는것**"*.
 *
 * 🔴 **운행 쓰기는 없다** — 출발/종료·탑승 체크는 전부 오늘 등하원 화면에 있다(운행 현황과 같은 결).
 *    쓰는 것은 [위치 수정](정류장 좌표) 하나 — 저장 액션과 같은 `canWriteTenant(shuttle)`로 입구를 연다.
 * 🔴 **아직 위치 데이터가 없다**는 것을 화면이 정직하게 말한다 — 가짜 지도·더미 좌표를 그리지 않는다.
 *    채워지려면 ① 운행 중 폰이 위치를 보내는 기능 ② 카카오 지도 키가 필요하고, 둘 다 아직 없다.
 * 🔑 데이터는 운행 현황과 **똑같은 것**을 받는다 — 같은 재료를 다르게 받으면 두 화면의 숫자가 갈린다.
 */
export default async function ShuttleTrackPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; season?: string }>;
}) {
  // 열람 = 메뉴 권한 또는 '셔틀 담당' 토글(access.ts). 반환값에 tenantId가 있어 따로 안 부른다.
  const user = await requireShuttleView();
  // 🔒 원장·관리자·총괄 전용(2026-10-08) — 그 밖은 404(있는 화면인지조차 알리지 않는다, 학부모 관리 현황과 같은 결).
  if (!(await isShuttleAdmin())) notFound();
  const sp = await searchParams;
  const date = sp.d && YMD.test(sp.d) ? sp.d : kstToday();
  const season: Season = isSeason(sp.season) ? sp.season : "term";

  // 서로 독립 — 함께 받는다(B4 직렬 워터폴 금지).
  const [board, boardings, exceptionsRes, tripsRes, canEditStops] = await Promise.all([
    getShuttleBoard(season),
    getBoardingsOn(date),
    getRideExceptionsOn(date), // 표가 없으면 ready:false로 조용히 접힌다([[#95]])
    getTripsOn(date), // 0243a. ready:false면 화면이 상태를 아예 안 그린다
    // [위치 수정] = saveStopLocation의 gate()와 같은 판정(관리자라도 셔틀이 '읽기'면 없다).
    canWriteTenant(user.systemRole, "shuttle"),
  ]);

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      {!board.ready && !boardings.ready ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          셔틀 표가 아직 준비되지 않았습니다 — 마이그레이션 <span className="num">0225a</span>를
          적용하면 바로 쓸 수 있습니다.
        </div>
      ) : (
        <TrackClient
          tenantId={user.tenantId}
          date={date}
          season={season}
          vehicles={board.vehicles}
          runs={board.runs}
          logs={boardings.logs}
          exceptions={exceptionsRes.exceptions}
          // 좌표(0244a)가 실려 온다 — 지도 준비 상태를 세는 재료.
          stops={board.stops}
          // Map은 서버→클라 경계를 못 넘어 **엔트리 배열**로 넘긴다(다른 셔틀 면과 같은 모양).
          trips={[...tripsRes.trips.entries()]}
          tripsReady={tripsRes.ready}
          // 🔑 '오늘'은 서버(KST)가 내려준다 — 지난 날짜를 열어 둔 화면은 바뀔 일이 없어
          //    실시간 채널을 아예 안 연다.
          today={kstToday()}
          canEditStops={canEditStops}
        />
      )}
    </div>
  );
}
