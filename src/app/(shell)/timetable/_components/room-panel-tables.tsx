"use client";

import { AlertTriangle } from "@/components/icons/eywa-icon-compat";
import { DAY_LABEL } from "@/features/timetable/lib/split-attendance";
import {
  ROOM_DAY_ORDER,
  type RoomHourBand,
  type RoomHourRow,
  type RoomWeekRow,
} from "@/features/timetable/lib/room-metrics";
import { RoomCapacityCell } from "./room-capacity-cell";

// 주간 활성도 표 2종 — 요일별(교실×월~일) / 시간대별(교실×주중 1시간 밴드).
// 셀 색 = 브랜드 단색 농도 스케일(크기=농도 단일 인코딩). 창 밖·측정 불가는 "—"(0%로 속이지 않는다).

const heatCls = (pct: number | null): string => {
  if (pct == null) return "text-text-faint";
  if (pct >= 80) return "bg-primary/70 text-primary-foreground";
  if (pct >= 60) return "bg-primary/50 text-primary-foreground";
  if (pct >= 40) return "bg-primary/30";
  if (pct >= 20) return "bg-primary/15";
  if (pct > 0) return "bg-primary/8";
  return "text-text-dim";
};

const TH = "border-line border-b px-1.5 py-1 text-center font-medium whitespace-nowrap";
const NAME_TD = "border-line text-foreground border-b px-2 py-1 font-medium whitespace-nowrap";

export function RoomDayTable({
  rows,
  canEditCapacity,
}: {
  rows: RoomWeekRow[];
  canEditCapacity: boolean;
}) {
  return (
    <table className="min-w-full border-separate border-spacing-0 text-[11px]">
      <thead>
        <tr className="text-text-dim">
          <th className={`${TH} text-left`}>강의실</th>
          {ROOM_DAY_ORDER.map((d) => (
            <th key={d} className={TH}>
              {DAY_LABEL[d] ?? d}
            </th>
          ))}
          <th className={`${TH} text-right`}>주중 가동률</th>
          <th className={`${TH} text-right`} title="주간 최대 동시 인원 / 정원 (좌석 활용 %)">
            최대 인원/정원
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const seatPct =
            r.capacity != null && r.capacity > 0 && r.maxStudents > 0
              ? Math.round((r.maxStudents / r.capacity) * 100)
              : null;
          return (
            <tr key={r.key}>
              <td className={NAME_TD}>
                {r.name}
                {r.registered ? "" : <span className="text-text-faint"> ※ 미등록</span>}
              </td>
              {ROOM_DAY_ORDER.map((d) => {
                const m = r.days[d];
                return (
                  <td key={d} className={`border-line num border-b px-1 py-1 text-center ${heatCls(m.utilPct)}`}>
                    {m.utilPct == null ? "—" : `${m.utilPct}%`}
                    {m.conflictPairs > 0 ? (
                      <AlertTriangle
                        size={10}
                        strokeWidth={2}
                        className="ml-0.5 inline-block align-[-1px] text-red-500"
                        aria-label="시간 겹침"
                      />
                    ) : null}
                  </td>
                );
              })}
              <td className="border-line num text-foreground border-b px-2 py-1 text-right font-semibold">
                {r.weekdayUtilPct == null ? "—" : `${r.weekdayUtilPct}%`}
              </td>
              <td className="border-line border-b px-2 py-1 text-right whitespace-nowrap">
                <span className="num text-text-dim">{r.maxStudents > 0 ? r.maxStudents : "—"}</span>
                {r.registered ? (
                  <>
                    <span className="text-text-faint">/</span>
                    <RoomCapacityCell roomId={r.key} capacity={r.capacity} canEdit={canEditCapacity} />
                  </>
                ) : null}
                {seatPct != null ? (
                  <span className={`num ml-1 ${seatPct > 100 ? "font-semibold text-red-600" : "text-text-dim"}`}>
                    {seatPct}%
                  </span>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function RoomHourTable({ bands, rows }: { bands: RoomHourBand[]; rows: RoomHourRow[] }) {
  if (bands.length === 0) {
    return <p className="text-text-dim px-2 py-3 text-[11px]">주중 운영 시간이 없어 시간대별 표를 만들 수 없습니다.</p>;
  }
  return (
    <table className="min-w-full border-separate border-spacing-0 text-[11px]">
      <thead>
        <tr className="text-text-dim">
          <th className={`${TH} text-left`}>강의실</th>
          {bands.map((b) => (
            <th key={b.startMin} className={TH}>
              {b.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className={NAME_TD}>
              {r.name}
              {r.registered ? "" : <span className="text-text-faint"> ※ 미등록</span>}
            </td>
            {r.cells.map((pct, i) => (
              <td key={i} className={`border-line num border-b px-1 py-1 text-center ${heatCls(pct)}`}>
                {pct == null ? "—" : `${pct}%`}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
