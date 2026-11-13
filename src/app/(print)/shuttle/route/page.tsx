import { headers } from "next/headers";
import { phoneLabel } from "@/lib/format/phone";
import { PrintActions } from "@/app/(print)/enrollment/[id]/print/print-actions";
import { requireShuttleView } from "@/features/shuttle/server/access";
import { kstToday, formatKoreanDate } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getRideExceptionsOn, getShuttleBoard } from "@/features/shuttle/server/queries";
import {
  compactWeekdays,
  dayCodeOf,
  plannedRidesOn,
  type PlannedRide,
} from "@/features/shuttle/roster";
import {
  DIRECTION_LABEL,
  RUN_STOP_KIND_LABEL,
  SEASON_LABEL,
  dayLabel,
  isSeason,
  runTitle,
  type Season,
  type ShuttleRider,
} from "@/features/shuttle/types";

export const metadata = { title: "셔틀 노선표 인쇄 — 에이와" };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 노선표 표의 **단일 격자** — 회차 표가 여러 개라도 열 위치가 같아야 기사가 훑어 읽는다.
 * ⚠️ 폭은 %로 준다(A4 인쇄와 화면 미리보기가 같은 비율로 접힌다). 여기 말고 다른 곳에서 열 폭을 주지 말 것.
 * ⚠️ 합이 100%다 — 바꿀 땐 명단(가장 많이 넘치는 칸)에서 덜어내고 채운다.
 */
function Cols() {
  return (
    <colgroup>
      <col className="w-[7%]" />
      <col className="w-[29%]" />
      <col className="w-[10%]" />
      <col className="w-[44%]" />
      <col className="w-[10%]" />
    </colgroup>
  );
}

/**
 * 기사용 노선표(A4) — 회차마다 [정류장 · 시각 · 승차/하차 명단].
 *
 * 두 가지 모드:
 *  · `?d=YYYY-MM-DD` — **그날 실제로 타는 사람만**(요일 규칙 적용). 기사가 오늘 들고 나가는 종이.
 *  · `?d=all` — 요일 무관 **전체 편성**(요일을 이름 옆에 표기). 편성 검토·게시용.
 *
 * ⚠️ 인쇄 버튼이 있는 모든 곳은 플로팅 창 + A4 규약(design-conventions) — `(print)` 라우트 그룹.
 * ⚠️ 헤더에 비ASCII를 직접 넣지 않는다(B1) — 이 라우트는 HTML만 내려주므로 해당 없음.
 *
 * 🔴 **회차마다 표가 따로라 열 너비를 고정하지 않으면 종이에서 열이 어긋난다**(원장 제보 2026-08-19
 *    *"인쇄할때도 열정리 시켜줘 열 위치가 제각각"*). 자동 폭은 **그 표의 최장 내용**에서 열 너비를 뽑으므로,
 *    명단이 긴 회차와 빈 회차의 '정류장·시각·명단' 위치가 서로 달라진다([[#97]]의 사촌).
 *    → `table-fixed` + **공용 `<colgroup>`**(아래 `Cols`)으로 모든 표가 같은 격자를 쓴다.
 */
export default async function ShuttleRoutePrintPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; d?: string; vehicle?: string }>;
}) {
  // 열람 게이트는 화면과 같은 함수 — 노선표 인쇄는 셔틀 담당(0227a)도 필요하다(#77: 표면마다 다른 게이트 금지).
  await requireShuttleView();
  const sp = await searchParams;
  const season: Season = isSeason(sp.season) ? sp.season : "term";
  const allDays = sp.d === "all";
  const date = !allDays && sp.d && YMD.test(sp.d) ? sp.d : kstToday();

  const embedded = (await headers()).get("x-embed") === "1";
  // 🔴 종이도 **같은 명단**을 봐야 한다 — 기사가 들고 나가는 게 이 종이다. 그날 모드일 때만 일회성
  //    예외(0229a)를 겹친다(`d=all`은 요일 무관 상시 편성이라 특정 날짜의 예외를 섞으면 거짓이 된다).
  const [board, settings, exceptionsRes] = await Promise.all([
    getShuttleBoard(season),
    getTenantSettings(),
    allDays ? Promise.resolve({ ready: false, exceptions: [] }) : getRideExceptionsOn(date),
  ]);

  const vehicles = sp.vehicle
    ? board.vehicles.filter((v) => v.id === sp.vehicle)
    : board.vehicles;
  const academy = settings.profile.name || "";

  return (
    <>
      <div className="mx-auto max-w-[190mm] px-8 pt-6 print:hidden">
        <PrintActions embedded={embedded} />
      </div>

      <div className="mx-auto max-w-[190mm] px-8 pb-10 print:px-0">
        <header className="mb-4 border-b-2 border-black pb-2">
          <h1 className="text-[18px] font-bold">
            {academy && `${academy} `}셔틀 노선표
          </h1>
          <p className="mt-0.5 text-[12px]">
            {SEASON_LABEL[season]} ·{" "}
            {allDays ? "전체 편성(요일 표기)" : `${formatKoreanDate(date)} (${dayLabel(dayCodeOf(date))})`}
          </p>
        </header>

        {vehicles.map((vehicle) => {
          const runs = board.runs.filter((r) => r.vehicleId === vehicle.id);
          if (runs.length === 0) return null;
          return (
            <section key={vehicle.id} className="mb-6 break-inside-avoid">
              <h2 className="mb-1 text-[15px] font-bold">
                {vehicle.name}
                {vehicle.driverName && (
                  <span className="ml-2 text-[12px] font-normal">
                    기사 {vehicle.driverName}
                    {vehicle.driverPhone && ` (${phoneLabel(vehicle.driverPhone)})`}
                  </span>
                )}
              </h2>

              {runs.map((run) => {
                // 그날 모드면 요일 규칙을 적용해 실제 탑승자만 남긴다.
                const planned = allDays ? null : plannedRidesOn(run, date, exceptionsRes.exceptions);
                const byStop = new Map<string, PlannedRide[]>();
                if (planned) {
                  for (const p of planned) {
                    const list = byStop.get(p.runStopId) ?? [];
                    list.push(p);
                    byStop.set(p.runStopId, list);
                  }
                  // 그날 아무도 안 타는 회차는 종이에서 뺀다(기사가 볼 이유가 없다).
                  // ⚠️ 전원이 '오늘 안 탐'인 회차도 여기서 빠지지 않는다 — **왜 안 가는지**가 종이에
                  //    남아야 기사가 "명단이 빠졌나" 하고 되묻지 않는다(화면과 같은 규약).
                  if (planned.length === 0) return null;
                }

                return (
                  <table
                    key={run.id}
                    className="mb-3 w-full table-fixed break-inside-avoid border-collapse text-[11.5px]"
                  >
                    <caption className="mb-0.5 text-left text-[12.5px] font-bold">
                      {runTitle(run)} · {DIRECTION_LABEL[run.direction]}
                    </caption>
                    <Cols />
                    <thead>
                      <tr className="border-y border-black">
                        <th className="py-1 text-center font-bold">순서</th>
                        <th className="py-1 text-center font-bold">정류장</th>
                        <th className="py-1 text-center font-bold">시각</th>
                        <th className="py-1 text-center font-bold">명단</th>
                        <th className="py-1 text-center font-bold">확인</th>
                      </tr>
                    </thead>
                    <tbody>
                      {run.stops.map((stop, i) => {
                        const riders: PlannedRide[] | ShuttleRider[] = planned
                          ? (byStop.get(stop.id) ?? [])
                          : stop.riders;
                        const campus = stop.kind !== "stop";
                        return (
                          <tr key={stop.id} className="border-b border-neutral-300 align-top">
                            <td className="py-1 text-center">{i + 1}</td>
                            {/* 폭이 고정이라 긴 정류장명은 칸 안에서 접힌다 — 전역 `overflow-wrap: anywhere`
                                (globals.css)가 그 일을 한다. ⚠️ `break-keep`을 붙이지 말 것: 그건 줄바꿈
                                기회를 **없애는** 속성이라 넘침을 막아 주지 않는다(전역 keep-all과 중복이기도). */}
                            <td className="py-1">
                              {campus ? RUN_STOP_KIND_LABEL[stop.kind] : stop.stopName}
                              {stop.stopMemo && (
                                <span className="text-[10.5px]"> · {stop.stopMemo}</span>
                              )}
                            </td>
                            <td className="num py-1 text-center">{stop.atTime ?? ""}</td>
                            {/* 🔴 그날 모드에서는 **일회성 변경을 종이에도 적는다** — 오늘만 타는 아이는
                                굵게 '오늘만', 오늘 빠지는 아이는 **지우지 않고** 취소선 + '오늘 안 탐'.
                                명단에서 통째로 지우면 기사가 "연락을 못 받은 건지 빠진 건지" 알 수 없다. */}
                            <td className="py-1">
                              {planned
                                ? (riders as PlannedRide[]).map((p, k) => (
                                    <span key={p.rider.id} className={p.dayKind === "skipped" || p.dayKind === "replaced" ? "line-through" : ""}>
                                      {k > 0 && "  "}
                                      {p.rider.studentName}
                                      {p.dayKind === "added" && <b className="font-bold">(오늘만)</b>}
                                      {p.dayKind === "skipped" && <span>(오늘 안 탐)</span>}
                                      {p.dayKind === "replaced" && <span>(오늘은 다른 정류장)</span>}
                                    </span>
                                  ))
                                : (riders as ShuttleRider[])
                                    .map((r) => `${r.studentName}(${compactWeekdays(r.weekdays)})`)
                                    .join("  ")}
                            </td>
                            {/* 기사가 손으로 체크하는 칸 — 종이 노선표의 핵심(태웠는지 표시). */}
                            <td className="py-1" />
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                );
              })}
            </section>
          );
        })}

        {vehicles.length === 0 && (
          <p className="py-10 text-center text-[13px]">인쇄할 차량이 없습니다.</p>
        )}
      </div>
    </>
  );
}
