"use client";

/**
 * 데스크 좌석표 — 층 띠 → 강의실(칠판+좌석). 칸 = 그 반의 오늘 학생 하나.
 */
import { EmptyState } from "@/components/empty-state";
import { CalendarDays } from "@/components/icons/eywa-icon-compat";
import { SEAT_MARK_LABEL, SEAT_MARK_TONE } from "../mark-state";
import { foldSeating, seatingSummary } from "../seating";
import { groupSeatingFloors } from "../seating-floors";
import type { LiveBoard } from "../types";
import { SeatingRoom } from "./seating-room";

const LEGEND: Array<keyof typeof SEAT_MARK_LABEL> = [
  "present",
  "absent",
  "late",
  "unmarked",
  "waiting",
];

export function SeatingChart({ board }: { board: LiveBoard }) {
  const slots = board.teachers.flatMap((t) => t.slots);
  const classes = foldSeating(slots);
  if (classes.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="이 날은 수업이 없습니다"
        description="시간표에 열린 수업이 없습니다."
      />
    );
  }
  const sum = seatingSummary(classes);
  const floors = groupSeatingFloors(classes);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="text-sm font-bold">
          미출결 <span className="num text-att-absent-ink">{sum.unmarked}</span>
          <span className="text-text-faint mx-1.5">·</span>
          결석 <span className="num text-att-absent-ink">{sum.absent}</span>
          <span className="text-text-faint mx-1.5">·</span>
          입력{" "}
          <span className={`num ${sum.recorded >= sum.expected ? "text-primary" : "text-amber-strong"}`}>
            {sum.recorded}/{sum.expected}
          </span>
        </p>
        <ul className="ml-auto flex flex-wrap items-center gap-2">
          {LEGEND.map((k) => (
            <li
              key={k}
              className={`rounded-lg px-2 py-0.5 text-[12px] font-bold ${SEAT_MARK_TONE[k]}`}
            >
              {SEAT_MARK_LABEL[k]}
            </li>
          ))}
        </ul>
      </header>

      {floors.map((floor) => (
        <section key={floor.key} className="space-y-4">
          <h2 className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-xl font-bold">{floor.label}</span>
            {floor.unmarked > 0 && (
              <span className="text-att-absent-ink text-sm font-bold">미출결 {floor.unmarked}</span>
            )}
          </h2>
          <div className="space-y-4">
            {floor.rooms.map((room) => (
              <div key={room.key} className="space-y-2">
                <h3 className="text-base font-bold">{room.roomName}</h3>
                <div className="grid grid-cols-4 items-start gap-3">
                  {room.classes.map((klass) => (
                    <SeatingRoom key={klass.classId} date={board.date} klass={klass} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
