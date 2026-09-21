import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getShuttleBoard } from "@/features/shuttle/server/queries";
import { isSeason, type Season } from "@/features/shuttle/types";
import { getAssignableStudents } from "@/features/shuttle/server/students";
import { requireShuttleView } from "@/features/shuttle/server/access";
import { ShuttleBoardClient } from "./_components/shuttle-board-client";

export const metadata = { title: "셔틀 — aywa" };

/**
 * 셔틀 노선 편성 — 원장 2026-08-19: makeedu 노랑버스에서 이관.
 * 정류장 마스터 + 차량 × 시즌 × 회차 × 정류장 순서 + 학생 배정(요일별). 편집은 드래그&드롭.
 *
 * 접근 = `shuttle` 메뉴(사무실 full / 나머지 readonly). 쓰기 판정은 화면·액션이 **같은 함수**
 * (canWriteTenant)를 쓴다([[#77]] — UI 조건은 게이트가 아니다).
 */
export default async function ShuttlePage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; run?: string }>;
}) {
  // 열람 = 메뉴 권한 또는 '셔틀 담당' 토글(access.ts). 담당 토글은 **열람만** 연다 —
  // 편성 수정은 아래 canWriteTenant 그대로 사무실뿐이다.
  const user = await requireShuttleView();
  const sp = await searchParams;
  const season: Season = isSeason(sp.season) ? sp.season : "term";

  // 서로 독립 — 함께 받는다(B4).
  const [board, canWrite, students] = await Promise.all([
    getShuttleBoard(season),
    canWriteTenant(user.systemRole, "shuttle"),
    getAssignableStudents(),
  ]);

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      {!board.ready ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          셔틀 표가 아직 준비되지 않았습니다 — 마이그레이션 <span className="num">0225a</span>를
          적용하면 바로 쓸 수 있습니다.
        </div>
      ) : (
        <ShuttleBoardClient
          season={season}
          vehicles={board.vehicles}
          runs={board.runs}
          stops={board.stops}
          students={students}
          selectedRunId={sp.run ?? null}
          canWrite={canWrite}
          // 0244a 적용 여부 — 좌표는 기존 select와 **따로** 받으므로 컬럼이 없어도 보드는 그대로 산다.
          coordsReady={board.coordsReady}
        />
      )}
    </div>
  );
}
