import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { getBoardingsOn, getShuttleBoard } from "@/features/shuttle/server/queries";
import { getAbsentStudentIdsOn } from "@/features/shuttle/server/attendance-link";
import { canRecordBoarding } from "@/features/shuttle/server/record-gate";
import { isSeason, type Season } from "@/features/shuttle/types";
import { DayBoardClient } from "./_components/day-board-client";

export const metadata = { title: "셔틀 — eywa" };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 오늘 등하원 — 그날 타기로 되어 있는 사람(정기 배정 × 요일)과 실제 기록을 겹쳐 보여준다.
 * 🔴 기록이 없는 줄은 "미탑승"이 아니라 **아직 안 찍음**이다(roster.mergePlanAndLog 주석).
 *
 * 원장 2026-08-19: *"셔틀 등하원 기록도 모두 DB화"* — 여기서 찍은 것이 `shuttle_boardings`에 남고,
 * 출결 화면은 그중 미탑승만 **신호로** 읽는다(자동 결석 처리 없음).
 */
export default async function ShuttleTodayPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; season?: string }>;
}) {
  await requireAccess("shuttle");
  const sp = await searchParams;
  const date = sp.d && YMD.test(sp.d) ? sp.d : kstToday();
  const season: Season = isSeason(sp.season) ? sp.season : "term";

  // 넷 다 서로 독립 — 함께 받는다(B4). absentIds는 **신호 전용**(출결을 바꾸지 않는다).
  const [board, { ready, logs }, canWrite, absentIds] = await Promise.all([
    getShuttleBoard(season),
    getBoardingsOn(date),
    canRecordBoarding(), // 🔴 편성 권한이 아니라 **기록** 권한(record-gate.ts) — 화면·액션이 같은 함수를 본다(#77)
    getAbsentStudentIdsOn(date),
  ]);

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      {!board.ready && !ready ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          셔틀 표가 아직 준비되지 않았습니다 — 마이그레이션 <span className="num">0225a</span>를
          적용하면 바로 쓸 수 있습니다.
        </div>
      ) : (
        <DayBoardClient
          date={date}
          season={season}
          vehicles={board.vehicles}
          runs={board.runs}
          logs={logs}
          absentStudentIds={[...absentIds]}
          canWrite={canWrite}
        />
      )}
    </div>
  );
}
