import { FaceTabs } from "@/components/face-tabs";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { isShuttleAdmin, requireShuttleView } from "@/features/shuttle/server/access";
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
 * 📌 **차량 하나씩 본다**(원장 2026-10-08 *"1호차 2호차로 바꿔서 볼수있게 · 스크롤이 너무 많이"*) — 전 차량을
 *    한 줄로 늘어놓으면 세로가 끝없이 길어진다. 차량 탭(`?v=`) + 넓은 창에선 회차 표 2열.
 *
 * 열람 = 다른 셔틀 면과 같은 문(`requireShuttleView` — 메뉴 권한 ∪ '셔틀 담당' 토글).
 * 재료 = 편성 보드 한 번(`getShuttleBoard`) — 새 조회·새 표 없음.
 */
export default async function ShuttleWeekPage({ searchParams }: { searchParams: Promise<{ season?: string; v?: string }> }) {
  await requireShuttleView();
  const sp = await searchParams;
  const season: Season = isSeason(sp.season) ? sp.season : "term";
  const [board, showTrack] = await Promise.all([getShuttleBoard(season), isShuttleAdmin()]);

  const isActive = (status: string) => status === "enrolled";
  // 회차는 출발 시각 순(시각이 없으면 회차 번호).
  const firstTime = (run: (typeof board.runs)[number]) => runTimeRange(run.stops).slice(0, 5) || "99:99";
  const groups = [...board.vehicles]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((v) => ({
      vehicle: v,
      runs: board.runs
        .filter((r) => r.vehicleId === v.id)
        .sort((a, b) => firstTime(a).localeCompare(firstTime(b)) || a.runNo - b.runNo),
    }))
    .filter((g) => g.runs.length > 0);
  // 고른 차량이 이 시즌에 없으면(방학중엔 안 도는 차 등) 첫 차량으로.
  const current = groups.find((g) => g.vehicle.id === sp.v) ?? groups[0] ?? null;
  // 토·일 열은 **이 차량**에 주말 배정이 있을 때만(다른 차의 토요일 때문에 빈 열이 서지 않게).
  const days = weekColumns(current?.runs ?? []);
  const href = (s: Season, v: string | undefined) => `${SHUTTLE_WEEK_PATH}?season=${s}${v ? `&v=${v}` : ""}`;

  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      <div className={SHUTTLE_TOOLBAR}>
        <span className="min-w-0 flex-1 basis-full sm:basis-auto">
          {/* 관리자 면(실시간 위치·가까운 노선 찾기)도 다른 면들과 같은 판정으로 붙인다 — 빠지면 이 면에서만 뒤쪽 탭이 사라진다. */}
          <FaceTabs faces={shuttleFaces(season, { track: showTrack })} active={SHUTTLE_WEEK_PATH} ariaLabel="셔틀 면 전환" />
        </span>
        <ToolbarSegment label="시즌">
          {SEASONS.map((s) => (
            <ToolbarSegmentItem key={s} active={s === season} href={href(s, current?.vehicle.id)}>
              {SEASON_LABEL[s]}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
      </div>

      {!board.ready ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          셔틀 표가 아직 준비되지 않았습니다 — 마이그레이션 <span className="num">0225a</span>를 적용하면 바로 쓸 수 있습니다.
        </div>
      ) : !current ? (
        <div className="border-line bg-card text-text-dim rounded-2xl border border-dashed p-8 text-center text-sm">
          {SEASON_LABEL[season]} 편성된 회차가 없습니다 — &lsquo;노선 편성&rsquo;에서 회차를 만들면 여기에 시간표로 보입니다.
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ToolbarSegment label="차량" wrap>
              {groups.map((g) => (
                <ToolbarSegmentItem key={g.vehicle.id} active={g.vehicle.id === current.vehicle.id} href={href(season, g.vehicle.id)}>
                  {g.vehicle.name}
                </ToolbarSegmentItem>
              ))}
            </ToolbarSegment>
            <span className="text-text-dim text-sm">
              {current.vehicle.driverName ? <>기사 {current.vehicle.driverName} · </> : null}
              <span className="num">{current.runs.length}</span>개 회차
            </span>
          </div>
          <div className="@container">
            <div className="grid items-start gap-3 @5xl:grid-cols-2">
              {current.runs.map((run) => (
                <WeekRunTable key={run.id} run={run} days={days} week={buildRunWeek(run, days, isActive)} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
