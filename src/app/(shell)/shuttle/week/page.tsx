import { FaceTabs } from "@/components/face-tabs";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { requireShuttleView } from "@/features/shuttle/server/access";
import { getShuttleBoard } from "@/features/shuttle/server/queries";
import { SHUTTLE_TOOLBAR } from "@/features/shuttle/control-size";
import { SHUTTLE_WEEK_PATH, shuttleFaces } from "@/features/shuttle/faces";
import { SEASONS, SEASON_LABEL, isSeason, runTimeRange, type Season } from "@/features/shuttle/types";
import { buildRunWeek, weekColumns } from "@/features/shuttle/week-grid";
import { WeekRunTable } from "./_components/week-run-table";

export const metadata = { title: "셔틀 주간 시간표 — 에이와" };

/**
 * 셔틀 **주간 시간표** — 원장 2026-10-08: 구글 시트 '셔틀버스(차량) 탑승현황'처럼 회차마다 [정류장 × 요일] 표로
 * 누가 어디서 타고 내리는지 한 번에 보는 화면. 보기 전용이다(편성은 '노선 편성'에서 — 같은 데이터).
 *
 * 열람 = 다른 셔틀 면과 같은 문(`requireShuttleView` — 메뉴 권한 ∪ '셔틀 담당' 토글).
 * 재료 = 편성 보드 한 번(`getShuttleBoard`) — 새 조회·새 표 없음.
 */
export default async function ShuttleWeekPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  await requireShuttleView();
  const sp = await searchParams;
  const season: Season = isSeason(sp.season) ? sp.season : "term";
  const board = await getShuttleBoard(season);

  const days = weekColumns(board.runs);
  const isActive = (status: string) => status === "enrolled";
  const vehicles = [...board.vehicles].sort((a, b) => a.sortOrder - b.sortOrder);
  // 회차는 차량 순 → 그 안에서 출발 시각 순(시각이 없으면 회차 번호).
  const firstTime = (run: (typeof board.runs)[number]) => runTimeRange(run.stops).slice(0, 5) || "99:99";
  const groups = vehicles
    .map((v) => ({
      vehicle: v,
      runs: board.runs
        .filter((r) => r.vehicleId === v.id)
        .sort((a, b) => firstTime(a).localeCompare(firstTime(b)) || a.runNo - b.runNo),
    }))
    .filter((g) => g.runs.length > 0);

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      <div className={SHUTTLE_TOOLBAR}>
        <span className="min-w-0 flex-1 basis-full sm:basis-auto">
          <FaceTabs faces={shuttleFaces(season)} active={SHUTTLE_WEEK_PATH} ariaLabel="셔틀 면 전환" />
        </span>
        <ToolbarSegment label="시즌">
          {SEASONS.map((s) => (
            <ToolbarSegmentItem key={s} active={s === season} href={`${SHUTTLE_WEEK_PATH}?season=${s}`}>
              {SEASON_LABEL[s]}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
      </div>

      {!board.ready ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          셔틀 표가 아직 준비되지 않았습니다 — 마이그레이션 <span className="num">0225a</span>를 적용하면 바로 쓸 수 있습니다.
        </div>
      ) : groups.length === 0 ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          {SEASON_LABEL[season]} 편성된 회차가 없습니다 — &lsquo;노선 편성&rsquo;에서 회차를 만들면 여기에 시간표로 보입니다.
        </div>
      ) : (
        groups.map((g) => (
          <div key={g.vehicle.id} className="flex flex-col gap-3">
            <h2 className="text-foreground text-lg font-bold">
              {g.vehicle.name}
              {g.vehicle.driverName ? <span className="text-text-dim ml-2 text-sm font-medium">기사 {g.vehicle.driverName}</span> : null}
            </h2>
            {g.runs.map((run) => (
              <WeekRunTable key={run.id} run={run} vehicleName={g.vehicle.name} days={days} week={buildRunWeek(run, days, isActive)} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}
