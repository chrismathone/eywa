"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pill } from "@/components/atoms/pill";
import { cn } from "@/lib/utils";
import { TONE_COLOR } from "@/lib/design/semantic-color";
import { SHUTTLE_INPUT } from "@/features/shuttle/control-size";
import { moveRider, removeRider, updateRiderWeekdays } from "@/features/shuttle/server/actions";
import type { StudentAssignment } from "@/features/shuttle/student-assignments";
import { DIRECTION_LABEL, SHUTTLE_DAYS, dayLabel, type Season } from "@/features/shuttle/types";

/**
 * 학생 풀에서 **배정된 아이를 누르면** 그 아래 펼쳐지는 배정 목록(사용자 2026-10-21 *"어디에 배정됐는지 바로 수정할 수 있게"*).
 * 배정마다 한 줄: `1호차 · 14:30 1회차 [등원] · 침산초 후문 14:50` + 요일 토글 · 정류장 옮기기 · 해제 · 회차 열기.
 *
 * 🔑 저장은 배정 칩과 **같은 서버 액션**(updateRiderWeekdays · moveRider · removeRider) — 새 쓰기 경로가 없다.
 * ⚠️ 요일을 모두 끄는 것은 해제로 안내한다(칩과 같은 규칙).
 */
export function AssignedEditor({
  assignments,
  season,
  canWrite,
  onError,
}: {
  assignments: readonly StudentAssignment[];
  season: Season;
  canWrite: boolean;
  onError: (msg: string | null) => void;
}) {
  return (
    <ul className="border-line bg-bg-soft mt-1 mb-1 flex flex-col gap-1.5 rounded-lg border p-1.5">
      {assignments.map((a) => (
        <AssignmentRow key={a.rider.id} a={a} season={season} canWrite={canWrite} onError={onError} />
      ))}
    </ul>
  );
}

function AssignmentRow({
  a,
  season,
  canWrite,
  onError,
}: {
  a: StudentAssignment;
  season: Season;
  canWrite: boolean;
  onError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();

  function act(fn: () => Promise<{ error?: string } | undefined>) {
    onError(null);
    startTransition(async () => {
      const res = await fn();
      if (res?.error) onError(res.error);
      else router.refresh();
    });
  }

  function toggleDay(day: string) {
    const next = new Set(a.rider.weekdays as string[]);
    if (next.has(day)) next.delete(day);
    else next.add(day);
    const list = SHUTTLE_DAYS.filter((d) => next.has(d));
    if (list.length === 0) {
      onError("요일을 모두 끄려면 [해제]로 배정을 풀어 주세요");
      return;
    }
    const fd = new FormData();
    fd.set("id", a.rider.id);
    fd.set("weekdays", list.join(","));
    act(() => updateRiderWeekdays(fd));
  }

  function unassign() {
    const fd = new FormData();
    fd.set("id", a.rider.id);
    act(() => removeRider(fd));
  }

  return (
    <li className={cn("bg-card flex flex-col gap-1.5 rounded-md p-2 text-sm", busy && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span className="font-bold">{a.vehicleName}</span>
        <span className="num text-text-dim">{a.runTime}</span>
        <span className="text-text-dim">{a.runName}</span>
        <Pill color={TONE_COLOR[a.direction === "in" ? "info" : "special"]}>{DIRECTION_LABEL[a.direction]}</Pill>
        <Link
          href={`/shuttle?season=${season}&run=${a.runId}`}
          className="text-primary ml-auto text-xs font-bold underline-offset-2 hover:underline"
          title="가운데 노선에 이 회차를 엽니다"
        >
          회차 열기
        </Link>
      </div>

      {canWrite ? (
        <>
          <label className="flex items-center gap-1.5">
            <span className="text-text-dim shrink-0 text-xs">정류장</span>
            <select
              value={a.runStopId}
              disabled={busy}
              onChange={(e) => {
                const to = e.target.value;
                if (to && to !== a.runStopId) act(() => moveRider(a.rider.id, to));
              }}
              className={cn(SHUTTLE_INPUT, "min-w-0 flex-1 bg-card")}
              aria-label={`${a.rider.studentName} ${a.vehicleName} ${a.runName} 정류장`}
            >
              {a.runStops.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.time ? `${s.time} ` : ""}
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-0.5">
            {SHUTTLE_DAYS.map((d) => {
              const on = (a.rider.weekdays as string[]).includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={busy}
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  // size-guard-ok: 배정 칩의 요일 토글과 같은 크기 — 격자 밀도 예외, 폰은 44px.
                  className={`size-11 cursor-pointer rounded text-sm font-bold transition-colors sm:size-7 sm:text-xs ${
                    on ? "bg-primary text-primary-foreground" : "text-text-faint hover:bg-muted"
                  }`}
                >
                  {dayLabel(d)}
                </button>
              );
            })}
            <button
              type="button"
              disabled={busy}
              onClick={unassign}
              className="border-danger/40 bg-danger-soft text-danger ml-auto h-11 cursor-pointer rounded-md border px-2.5 text-xs font-bold sm:h-7"
              title={`${a.vehicleName} ${a.runName} 배정을 풉니다`}
            >
              해제
            </button>
          </div>
        </>
      ) : (
        <span className="text-text-dim text-xs">
          {a.stopTime ? `${a.stopTime} ` : ""}
          {a.stopName} · {a.daysLabel}
        </span>
      )}
    </li>
  );
}
