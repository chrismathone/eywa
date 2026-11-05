"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { VehicleRouteDialog } from "@/features/shuttle/parent/components/vehicle-route-dialog";
import { loadStaffRideEditor, type StaffRideEditor } from "@/features/shuttle/ride-change/server/staff-ride-actions";
import type { StudentAssignment } from "@/features/shuttle/student-assignments";
import { DIRECTION_LABEL, type Direction, type Season } from "@/features/shuttle/types";
import { cn } from "@/lib/utils";
import { AssignedEditor } from "../../_components/assigned-editor";

type Mode = "choose" | "fixed";

/**
 * 탑승 학생 시간표 배차 카드의 **학생 한 명 = 수정 카드**(사용자 2026-11-04 "등하원 카드를 클릭하면 수정 카드를 띄우고
 * 당일만 수정인지 고정으로 변경하기는 다르게 버튼을 둬서").
 * · [당일만 수정] = 오늘 등하원 [등하원 수정]과 **같은 창·같은 저장**(`loadStaffRideEditor` → `VehicleRouteDialog staff`) —
 *   그날 하루만(`shuttle_ride_exceptions`), 평소 배정은 그대로.
 * · [고정으로 변경] = 노선 편성 학생 풀의 배정 편집기 **그대로**(`AssignedEditor` — 정류장 옮기기·요일·해제) — 매주 적용.
 * 🔑 이 화면 전용 저장 경로는 없다. 날짜·권한은 서버가 다시 본다([[#77]]).
 */
export function RiderDayEdit({
  studentId,
  studentName,
  runId,
  ioKind,
  date,
  dayEditable,
  place,
  season,
  assignments,
  canWrite,
  canEditDay,
  className,
  children,
}: {
  studentId: string;
  studentName: string;
  runId: string;
  ioKind: Direction;
  /** 그 카드의 날짜(YYYY-MM-DD). */
  date: string;
  /** 당일만 수정을 열 수 있나(오늘 이후) — 지난 날은 고정 변경만. */
  dayEditable: boolean;
  /** 카드에 보이는 자리("1호차 1회차 · 침산초 후문 14:50"). */
  place: string;
  season: Season;
  /** 이 학생의 평소 배정(그 시즌 전부). */
  assignments: readonly StudentAssignment[];
  /** 편성(고정) 쓰기 권한(canWriteTenant shuttle) — 없으면 [고정으로 변경]을 그리지 않는다. */
  canWrite: boolean;
  /**
   * 그날 하루 등하원 변경 권한 — page.tsx가 서버 게이트(`staffDayGate`·`loadStaffRideEditor`)와 **같은 함수**
   * `canRecordBoarding()`으로 계산한 값. 없으면 [당일만 수정]을 그리지 않는다(원장 2026-11-05 — 예전엔 눌러야 거절됐다).
   */
  canEditDay: boolean;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("choose");
  const [editor, setEditor] = useState<Extract<StaffRideEditor, { leg: unknown }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const md = `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  const word = DIRECTION_LABEL[ioKind];
  const mine = assignments.filter((a) => a.rider.ioKind === ioKind);

  function openDay() {
    setError(null);
    startLoading(async () => {
      const res = await loadStaffRideEditor({ studentId, onDate: date, ioKind, runId, season });
      if ("error" in res) setError(res.error);
      else {
        setOpen(false);
        setEditor(res);
      }
    });
  }

  const choice = "border-line hover:bg-muted flex flex-col items-start gap-0.5 rounded-xl border p-3 text-left disabled:cursor-not-allowed disabled:opacity-50";

  // 둘 다 못 하면 수정 카드를 열 이유가 없다 — 칩은 보기만 한다(누를 수 있는 것처럼 보이지 않게).
  if (!canEditDay && !canWrite) return <span className={className}>{children}</span>;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setMode("choose");
          setOpen(true);
        }}
        title={`${studentName} · ${md} ${word} 수정`}
        className={cn("hover:ring-primary cursor-pointer text-left hover:ring-1", className)}
      >
        {children}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="z-[90] max-h-[88vh] overflow-y-auto sm:max-w-lg">
          <DialogTitle>
            {studentName} {word} 수정
          </DialogTitle>
          <DialogDescription>
            {md} · {place}
          </DialogDescription>

          {/* 권한이 있는 선택지만 세운다(쓰기 단추는 비활성으로 남기지 않는다 — 원장 2026-11-05). */}
          <div className={cn("mt-2 grid gap-2", canEditDay && canWrite && "sm:grid-cols-2")}>
            {canEditDay ? (
              <button type="button" disabled={!dayEditable || loading} onClick={openDay} className={choice}>
                <span className="text-base font-bold">{loading ? "여는 중…" : "당일만 수정"}</span>
                <span className="text-text-dim text-sm break-keep">
                  {dayEditable ? `${md} 하루만 바뀌어요 · 평소 배정은 그대로` : "지난 날짜는 바꿀 수 없어요"}
                </span>
              </button>
            ) : null}
            {canWrite ? (
              <button
                type="button"
                aria-pressed={mode === "fixed"}
                onClick={() => setMode("fixed")}
                className={cn(choice, mode === "fixed" && "border-primary bg-primary-soft")}
              >
                <span className="text-base font-bold">고정으로 변경</span>
                <span className="text-text-dim text-sm break-keep">매주 적용 · 노선 편성의 배정이 바뀌어요</span>
              </button>
            ) : null}
          </div>

          {error ? <p className="text-danger mt-2 text-sm font-bold break-keep">{error}</p> : null}

          {mode === "fixed" && canWrite ? (
            mine.length > 0 ? (
              <div className="mt-2">
                <p className="text-text-dim text-sm">평소 {word} 배정 — 정류장·요일을 바꾸면 바로 저장돼요.</p>
                <AssignedEditor assignments={mine} season={season} canWrite={canWrite} onError={setError} />
              </div>
            ) : (
              <p className="text-text-dim mt-2 text-sm break-keep">
                평소 {word} 배정이 없어요(그날만 타는 학생). 고정으로 태우려면 노선 편성에서 정류장에 배정해 주세요.
              </p>
            )
          ) : null}
        </DialogContent>
      </Dialog>

      {editor ? (
        <VehicleRouteDialog
          key={`${studentId}|${ioKind}|${date}`}
          staff
          open
          onOpenChange={(next) => {
            if (!next) setEditor(null);
          }}
          onSaved={() => router.refresh()}
          leg={editor.leg}
          other={editor.other}
          fleet={editor.fleet}
          dayLabel={`${studentName} · ${editor.dayLabel}`}
          onDate={date}
          today={editor.today}
          editable
        />
      ) : null}
    </>
  );
}
