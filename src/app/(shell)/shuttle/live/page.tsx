import { kstToday } from "@/lib/date-kst";
import {
  getBoardingsOn,
  getRideExceptionsOn,
  getShuttleBoard,
  getTripsOn,
} from "@/features/shuttle/server/queries";
import { requireShuttleView } from "@/features/shuttle/server/access";
import { isSeason, type Season } from "@/features/shuttle/types";
import { LiveBoardClient } from "./_components/live-board-client";

export const metadata = { title: "셔틀 운행 현황 — aywa" };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 운행 현황(관제) — 차 전체를 한눈에 보고 **이상한 것만** 짚는 화면.
 *
 * 원장(2026-09-02): *"동승하는 선생님이 학생들이 해당 버스에 탔는지 안 탔는지 쉽게 체크하며 **그걸
 * 관리자**"* 가 본다. `/shuttle/today`는 회차를 펼쳐 한 줄씩 다루는 **찍는 화면**이고, 여기는 반대다.
 *
 * 🔴 **쓰기 게이트가 없다** — 출발/종료·탑승 체크는 전부 오늘 등하원 화면에 있다. 관제는 보기만 한다.
 *    (열람 게이트 `requireShuttleView`는 메뉴 권한 ∪ '셔틀 담당' 토글 — 오늘 화면과 같은 문이다.)
 * 🔴 **운행 상태 표(0243a)가 없으면 상태를 그리지 않는다** — 표가 없을 땐 모든 회차가 '출발 전'으로
 *    보이는데 그건 사실이 아니라 "모른다"이다. 실제로 돌고 있는 차를 "출발 전"이라 말하지 않는다([[#95]]).
 */
export default async function ShuttleLivePage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; season?: string }>;
}) {
  // 열람 = 메뉴 권한 또는 '셔틀 담당' 토글(access.ts). 반환값에 tenantId가 있어 따로 안 부른다.
  const user = await requireShuttleView();
  const sp = await searchParams;
  const date = sp.d && YMD.test(sp.d) ? sp.d : kstToday();
  const season: Season = isSeason(sp.season) ? sp.season : "term";

  // 서로 독립 — 함께 받는다(B4 직렬 워터폴 금지).
  const [board, boardings, exceptionsRes, tripsRes] = await Promise.all([
    getShuttleBoard(season),
    getBoardingsOn(date),
    getRideExceptionsOn(date), // 표가 없으면 ready:false로 조용히 접힌다([[#95]])
    getTripsOn(date), // 0243a. ready:false면 화면이 상태를 아예 안 그린다
  ]);

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      {!board.ready && !boardings.ready ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          셔틀 표가 아직 준비되지 않았습니다 — 마이그레이션 <span className="num">0225a</span>를
          적용하면 바로 쓸 수 있습니다.
        </div>
      ) : (
        <LiveBoardClient
          tenantId={user.tenantId}
          date={date}
          season={season}
          vehicles={board.vehicles}
          runs={board.runs}
          logs={boardings.logs}
          exceptions={exceptionsRes.exceptions}
          // Map은 서버→클라 경계를 못 넘어 **엔트리 배열**로 넘긴다(오늘 등하원 화면과 같은 모양).
          trips={[...tripsRes.trips.entries()]}
          tripsReady={tripsRes.ready}
          // 🔑 '오늘'은 서버(KST)가 내려준다 — 지난 날짜를 열어 둔 화면은 바뀔 일이 없어
          //    실시간 채널을 아예 안 연다(WebSocket이 창마다 늘어나는 것을 막는다).
          today={kstToday()}
        />
      )}
    </div>
  );
}
