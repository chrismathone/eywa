"use client";

import { AlertTriangle } from "@/components/icons/eywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { DAY_LABEL } from "@/features/timetable/lib/split-attendance";
import type { RoomSlotLite } from "@/features/timetable/lib/room-grid";
import { ROOM_DAY_ORDER, type RoomWeekRow } from "@/features/timetable/lib/room-metrics";

// 주간 활성도 패널 — 강의실 × 요일 가동률 히트 테이블 + 저활용 스포트라이트 + 미배정 교시.
// "어느 교실이 효율적이지 못한가"를 지도 아래에서 숫자로 답한다. 셀 색 = 브랜드 단색 농도 스케일
// (크기=농도 단일 인코딩 — 히트맵 정석). 창 없는 요일(일요일 등)은 0%로 속이지 않고 "—".

const heatCls = (pct: number | null): string => {
  if (pct == null) return "text-text-faint";
  if (pct >= 80) return "bg-primary/70 text-primary-foreground";
  if (pct >= 60) return "bg-primary/50 text-primary-foreground";
  if (pct >= 40) return "bg-primary/30";
  if (pct >= 20) return "bg-primary/15";
  if (pct > 0) return "bg-primary/8";
  return "text-text-dim";
};

export function RoomWeekPanel({
  rows,
  unassigned,
}: {
  rows: RoomWeekRow[];
  unassigned: RoomSlotLite[];
}) {
  const subjects = useSubjectMaps();
  const registered = rows.filter((r) => r.registered);
  // 저활용 스포트라이트 — 주중 가동률 하위 3실(측정 가능한 실만). 이 한 줄이 이 화면의 결론이다.
  const idle = registered
    .filter((r) => r.weekdayUtilPct != null)
    .sort((a, b) => (a.weekdayUtilPct ?? 0) - (b.weekdayUtilPct ?? 0))
    .slice(0, 3);
  const noCapacity = registered.length > 0 && registered.every((r) => r.capacity == null);
  const seatOver = registered.filter((r) => r.seatOver);

  // 미배정 교시 — 반 단위로 묶어 짧게(교시 나열은 클러터). 반 편집으로 바로 배정하러 갈 수 있게 링크.
  const byClass = new Map<string, { className: string; subject: string; count: number }>();
  for (const s of unassigned) {
    const cur = byClass.get(s.classId);
    if (cur) cur.count++;
    else byClass.set(s.classId, { className: s.className, subject: s.subject, count: 1 });
  }

  return (
    <section className="bg-card border-line shadow-card shrink-0 rounded-2xl border p-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-foreground text-sm font-bold">주간 교실 활성도</h2>
        <span className="text-text-dim text-[11px]">
          가동률 = 수업 점유 시간 ÷ 그 요일 운영 시간(교시 설정 기준) · 주중 = 월~금 합산
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0 text-[11px]">
          <thead>
            <tr className="text-text-dim">
              <th className="border-line border-b px-2 py-1 text-left font-medium">강의실</th>
              {ROOM_DAY_ORDER.map((d) => (
                <th key={d} className="border-line border-b px-1 py-1 text-center font-medium">
                  {DAY_LABEL[d] ?? d}
                </th>
              ))}
              <th className="border-line border-b px-2 py-1 text-right font-medium">주중 가동률</th>
              <th className="border-line border-b px-2 py-1 text-right font-medium">최대 인원</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="border-line text-foreground border-b px-2 py-1 font-medium whitespace-nowrap">
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
                <td className="border-line num text-text-dim border-b px-2 py-1 text-right">
                  {r.maxStudents > 0 ? r.maxStudents : "—"}
                  {r.capacity != null ? `/${r.capacity}` : ""}
                  {r.seatOver ? <span className="text-red-500"> 초과</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-col gap-1 text-[11px]">
        {idle.length > 0 ? (
          <p className="text-text-dim">
            <span className="text-foreground font-semibold">주중 저활용</span>{" "}
            {idle.map((r, i) => (
              <span key={r.key}>
                {i > 0 ? " · " : ""}
                {r.name} <span className="num">{r.weekdayUtilPct}%</span>
              </span>
            ))}
          </p>
        ) : null}
        {seatOver.length > 0 ? (
          <p className="text-red-600">
            정원 초과: {seatOver.map((r) => `${r.name}(최대 ${r.maxStudents}명/정원 ${r.capacity}명)`).join(" · ")}
          </p>
        ) : null}
        {byClass.size > 0 ? (
          <p className="text-amber-700">
            강의실 미배정{" "}
            {[...byClass.entries()].map(([classId, c], i) => (
              <span key={classId}>
                {i > 0 ? " · " : ""}
                <WindowLink href={`/classes/${classId}`} className="underline underline-offset-2">
                  {c.className}
                </WindowLink>{" "}
                ({subjects.labelOf(c.subject)} {c.count}교시)
              </span>
            ))}
            <span className="text-text-dim"> — 반 편집에서 강의실을 지정하면 지도에 나타납니다</span>
          </p>
        ) : null}
        {noCapacity ? (
          <p className="text-text-faint">
            강의실 정원이 아직 입력되지 않았습니다 — 학원설정 · 운영 체계 · 강의실에서 정원을 넣으면 좌석
            활용(최대 인원/정원) 지표가 열립니다.
          </p>
        ) : null}
      </div>
    </section>
  );
}
