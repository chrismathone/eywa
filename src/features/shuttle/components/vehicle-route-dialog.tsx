"use client";

import { useState, useTransition } from "react";

import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  EDIT_CUTOFF_MINUTES,
  ridePairConflict,
  runEditClosed,
  runStartTime,
  SKIPPED_HEADLINE,
  type RidePoint,
  type RideLeg,
  type VehicleFleet,
  type VehicleRoute,
} from "../parent-rides";
import { changeParentRideStop, resetParentRide } from "../server/parent-ride-actions";
import { staffChangeRideStop, staffResetRide } from "../server/staff-ride-actions";
import { useRideDates } from "./ride-dates-context";
import { DIRECTION_LABEL } from "../types";
import { KstClock, useKstNow } from "./kst-clock";
import { Badge, FocusedRun, RunHeader } from "./vehicle-route-parts";

const CUTOFF_NOTE = `각 회차 출발 ${EDIT_CUTOFF_MINUTES}분 전까지만 수정할 수 있어요`;
/** 직원 수정은 출발 10분 전 마감이 없다(서버 `closedRunsMessage`가 행위자로 가른다). */
const STAFF_NOTE = "직원 수정 · 출발 직전에도 바꿀 수 있어요 · 학부모 화면에 바로 반영돼요";

/**
 * 학부모 '등원/하원 수정하기' — 누르면 **호차의 그날 전체 노선**을 모달로 보여 준다(사용자 2026-09-28).
 *
 * 🔑 처음엔 우리 아이가 타는 호차. 제목 옆 호차 버튼으로 **다른 호차의 노선**도 본다.
 * 🔑 회차 머리는 '1회차 · 14:30 출발'(학원 출발 칸 시각) — 등원/하원 글자는 싣지 않는다.
 * 🔑 회차를 **누르면**(한 번 — 2026-09-30 더블클릭에서 바꿈) 그 회차만 크게 보인다. 거기서 정류장을 누르면 '타는 곳 변경'으로 표시되고,
 *    [저장하기]를 누르면 **바로 DB에 반영**된다(사용자 2026-09-29) — 셔틀 선생님 화면에도 그대로 보인다.
 *    서버가 모든 조건을 다시 확인한다(parent-ride-actions.ts) — 여기의 잠금·선택 제한은 안내일 뿐이다([[#77]]).
 * 🔑 '지금 타는 곳'은 서버가 준 구간(`leg`)에서 읽는다 — 저장하면 페이지가 다시 그려지며 자리가 옮겨진다.
 * 🔑 회차의 등원/하원 방향은 가리지 않는다 — 어느 회차든 고른다(사용자 2026-09-29 "자유롭게").
 * 🔑 마감 = **회차 출발 10분 전**(사용자 2026-09-29) — **그 회차로** 바꾸는 것만 막는다. 지금 타는 회차가 마감이어도
 *    열린 다른 회차로는 옮길 수 있다. 마감된 회차엔 '수정 마감' 표시 · 고를 수 없다.
 *    시각은 브라우저 시계(분 단위)로 움직이고 서버가 다시 판정한다.
 * 🔴 변경 내역은 여기 없다 — 직원 전용(사용자 2026-09-29, 관리자 '학부모 등하원' 카드).
 * 🔑 마감된 회차는 시간·정류장은 보이되 **회색으로 흐리게**. '타지 않기'한 날은 "등원차를 타지 않습니다"를 띄우고
 *    '지금 타는 곳'을 비운다 — 다른 시간을 골라 저장하면(또는 '평소대로 다시 타기') 다시 탄다.
 * 🔑 정류장 이름·시각뿐이다 — 다른 아이 정보는 재료(`VehicleFleet`)에 없다.
 */
export function VehicleRouteDialog({
  leg,
  fleet,
  dayLabel,
  onDate,
  today,
  editable,
  other = null,
  staff = false,
  open,
  onOpenChange,
  onSaved,
}: {
  leg: RideLeg;
  /**
   * 직원(관리자 · 셔틀 선생님)이 셔틀 '오늘 등하원'에서 여는 창(사용자 2026-10-06) — 같은 창·같은 규칙에 저장만
   * 직원 액션(`staff-ride-actions.ts`)으로 간다. 머리에 '직원 수정' 표식을 달아 학부모 수정과 갈라 보인다.
   * 이때는 바깥이 열고 닫는다(`open`/`onOpenChange`, 버튼 없음).
   */
  staff?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** 저장·되돌리기가 성공하면(직원 화면이 그날 명단을 다시 읽는다). */
  onSaved?: () => void;
  /**
   * 그날 **반대 방향**이 타는 자리(회차·시각) — 짝 규칙(사용자 2026-09-30): 같은 회차 금지 · 등원이 하원보다 빨라야.
   * 안 타는 날이면 null. 판정은 서버와 같은 `ridePairConflict`(여기는 안내, 서버가 다시 막는다).
   */
  other?: RidePoint | null;
  fleet: readonly VehicleFleet[];
  /** 모달 설명 줄 — "오늘 · 2026년 9월 28일 (월)" / "2026년 10월 1일 (수) 일정". */
  dayLabel: string;
  /** 바꿀 날짜(YYYY-MM-DD). */
  onDate: string;
  /** 서버가 본 오늘(KST YYYY-MM-DD) — 마감 판정이 '오늘'일 때만 시각을 본다. */
  today: string;
  /** 지난 날짜면 false — 보기만. */
  editable: boolean;
}) {
  /** 월별 달력에서 여러 날을 골라 열었으면 그 날짜 전부에 같은 내용을 적용한다(없으면 그날 하루). */
  const dates = useRideDates();
  const [vehicleId, setVehicleId] = useState(leg.vehicleId);
  /** 눌러서 크게 보는 회차 — null이면 회차 목록. */
  const [focusRunId, setFocusRunId] = useState<string | null>(null);
  /** 크게 보기에서 고른(아직 저장 안 한) 정류장. */
  const [pickStopId, setPickStopId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const vehicle = fleet.find((v) => v.id === vehicleId);
  const routes = vehicle?.routes ?? [];
  const focused = focusRunId ? routes.find((r) => r.runId === focusRunId) ?? null : null;
  const verb = leg.direction === "in" ? "타는" : "내리는";
  // 안 타는 날('타지 않기')엔 '지금 타는 곳'이 없다 — 다른 시간을 고르면 다시 탄다.
  const mine = leg.skipped
    ? { runId: "", stopId: null }
    : { runId: leg.runId, stopId: leg.route.find((s) => s.mine)?.id ?? null };
  const now = useKstNow();
  // 시계가 아직 없으면(첫 렌더) 마감을 판정하지 않는다 — 서버가 어차피 다시 본다.
  const closed = (stops: VehicleRoute["stops"]) =>
    staff ? false : now ? runEditClosed(runStartTime(stops), onDate, today, now.minutes) : false;
  // 🔑 마감은 **고르려는 회차**에만 건다 — 지금 타는 회차가 마감이어도 열린 다른 회차로는 옮긴다(사용자 2026-09-29).
  const locked = editable ? null : "지난 날짜는 바꿀 수 없어요";
  // 🔑 짝 규칙 — 반대 방향이 탄 회차는 통째로, 시각이 어긋나는 정류장은 칸마다 못 고른다.
  const pairBlock = (runId: string, time: string | null) => ridePairConflict(leg.direction, { runId, time }, other);
  const sameRunAsOther = (runId: string) => !!other && other.runId === runId;
  const otherWord = leg.direction === "in" ? "하원" : "등원";
  const pickTime = focused?.stops.find((s) => s.id === pickStopId)?.time ?? null;
  const pickBlocked = focused && pickStopId ? pairBlock(focused.runId, pickTime) : null;

  // 열 때마다 지금 타는 호차의 회차 목록부터.
  function reset() {
    setVehicleId(leg.vehicleId);
    showList();
  }

  function showList() {
    setFocusRunId(null);
    setPickStopId(null);
    setNotice(null);
  }

  function focus(runId: string) {
    setFocusRunId(runId);
    setPickStopId(null);
    setNotice(null);
  }

  function pick(stopId: string) {
    setNotice(null);
    // 지금 타는 곳을 다시 누르면 고른 것을 취소한다.
    const isMine = focused?.runId === mine.runId && stopId === mine.stopId;
    setPickStopId(isMine || pickStopId === stopId ? null : stopId);
  }

  function save() {
    if (!focused || !pickStopId) return;
    const runStopId = pickStopId;
    startTransition(async () => {
      const res = staff
        ? await staffChangeRideStop({ studentId: leg.studentId, onDate, ioKind: leg.direction, runStopId })
        : await changeParentRideStop({ studentId: leg.studentId, onDate, ioKind: leg.direction, runStopId, dates });
      if ("error" in res) {
        setNotice({ tone: "error", text: res.error });
        return;
      }
      setPickStopId(null);
      setNotice({ tone: "ok", text: res.message });
      onSaved?.();
    });
  }

  function restore() {
    startTransition(async () => {
      const res = staff
        ? await staffResetRide({ studentId: leg.studentId, onDate, ioKind: leg.direction })
        : await resetParentRide({ studentId: leg.studentId, onDate, ioKind: leg.direction, dates });
      if ("error" in res) {
        setNotice({ tone: "error", text: res.error });
        return;
      }
      setPickStopId(null);
      setNotice({ tone: "ok", text: res.message });
      onSaved?.();
    });
  }

  const cutoffNote = staff ? STAFF_NOTE : CUTOFF_NOTE;

  return (
    <Dialog
      {...(open === undefined ? {} : { open })}
      onOpenChange={(next) => {
        if (next) reset();
        onOpenChange?.(next);
      }}
    >
      {staff ? null : (
        <DialogTrigger className="border-primary text-primary mt-2 flex h-10 w-full items-center justify-center rounded-lg border text-sm font-bold">
          {DIRECTION_LABEL[leg.direction]} 수정하기
        </DialogTrigger>
      )}
      <DialogContent className="gap-3">
        {/* 오른쪽 위 닫기(X) 자리를 비워 둔다(pr-8). */}
        <DialogHeader className="pr-8">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* 🔑 직원 수정 표식 — 학부모 수정과 한눈에 갈린다(사용자 2026-10-06 "명확하게 구별"). */}
            {staff ? (
              <span className="bg-amber text-white rounded-md px-2 py-0.5 text-xs font-bold">
                직원 수정 · {DIRECTION_LABEL[leg.direction]}
              </span>
            ) : null}
            <DialogTitle className="text-base font-bold">{vehicle?.name ?? leg.vehicleName} 전체 노선</DialogTitle>
            {!focused && fleet.length > 1 ? (
              <div role="group" aria-label="호차 선택" className="flex flex-wrap gap-1">
                {fleet.map((v) => {
                  const active = v.id === vehicleId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setVehicleId(v.id)}
                      className={`h-7 rounded-full px-2.5 text-xs font-bold ${
                        active ? "bg-primary text-primary-foreground" : "bg-bg-soft text-foreground"
                      }`}
                    >
                      {v.name}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <DialogDescription>
            {dayLabel} <KstClock className="text-foreground font-bold" />
          </DialogDescription>
          {dates ? (
            <p className="text-danger text-xs font-bold break-keep">
              선택한 {dates.length}일 모두 같은 내용으로 바뀌어요.
            </p>
          ) : null}
          {/* 마감 규칙은 늘 보인다 — 잠겼으면 왜 잠겼는지가 그 자리에 선다. */}
          <p className={`text-xs font-bold break-keep ${locked ? "text-danger" : "text-primary"}`}>
            {locked ?? (focused ? `${verb} 곳을 누른 뒤 저장하세요 · ${cutoffNote}` : `회차를 누르면 크게 볼 수 있어요 · ${cutoffNote}`)}
          </p>
        </DialogHeader>

        {leg.skipped ? (
          <p className="bg-bg-soft rounded-lg px-3 py-2 text-sm font-bold break-keep">
            {SKIPPED_HEADLINE[leg.direction]}
            <span className="text-text-dim block text-xs font-medium">다른 시간을 고르면 다시 {leg.direction === "in" ? "타요" : "내려요"}.</span>
          </p>
        ) : null}

        {focused ? (
          <FocusedRun
            route={focused}
            mine={mine}
            pickStopId={pickStopId}
            verb={verb}
            selectable={!locked && !closed(focused.stops)}
            closed={closed(focused.stops)}
            blockOf={(time) => pairBlock(focused.runId, time)}
            onPick={pick}
          />
        ) : routes.length === 0 ? (
          <p className="text-text-dim text-sm">이 호차는 등록된 노선이 없어요.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {routes.map((r) => {
              const current = r.runId === mine.runId;
              const isClosed = closed(r.stops);
              const otherRun = sameRunAsOther(r.runId);
              return (
                <li
                  key={r.runId}
                  // 🔑 한 번 누르면 그 회차 크게 보기(사용자 2026-09-30 — 더블클릭은 폰에서 안 먹고 헷갈렸다).
                  role="button"
                  tabIndex={0}
                  onClick={() => focus(r.runId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      focus(r.runId);
                    }
                  }}
                  // 마감된 회차 — 시간·정류장은 보이되 회색으로 흐리게(사용자 2026-09-29). 눌러 보기는 된다.
                  className={`cursor-pointer rounded-xl border px-3 py-2.5 select-none ${current ? "border-primary" : "border-line"} ${
                    isClosed || otherRun ? "bg-bg-soft opacity-50 grayscale" : ""
                  }`}
                >
                  <RunHeader route={r} current={current} verb={verb} closed={isClosed} />
                  {otherRun ? (
                    <p className="text-text-dim text-xs font-bold break-keep">{otherWord} 회차라 고를 수 없어요</p>
                  ) : null}
                  <ol className="mt-1 flex flex-col">
                    {r.stops.map((s) => {
                      const isMine = current && s.id === mine.stopId;
                      return (
                        <li key={s.id} className="flex items-center gap-2 py-0.5 text-sm">
                          <span className={`size-2 shrink-0 rounded-full ${isMine ? "bg-primary" : "bg-line"}`} aria-hidden />
                          <span className="num text-text-dim w-11 shrink-0">{s.time ?? "--:--"}</span>
                          <span
                            className={`min-w-0 break-keep ${isMine ? "font-bold" : s.kind === "stop" ? "" : "text-text-dim"}`}
                          >
                            {s.name}
                          </span>
                          {isMine ? <Badge tone="primary">지금 {verb} 곳</Badge> : null}
                        </li>
                      );
                    })}
                  </ol>
                </li>
              );
            })}
          </ol>
        )}

        {notice ? (
          <p
            role="status"
            className={`text-center text-sm font-bold break-keep ${notice.tone === "ok" ? "text-primary" : "text-danger"}`}
          >
            {notice.text}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          {focused ? (
            <button
              type="button"
              onClick={save}
              disabled={!pickStopId || pending || !!locked || !!pickBlocked}
              className="bg-primary text-primary-foreground flex h-11 w-full items-center justify-center rounded-lg text-sm font-bold disabled:opacity-40"
            >
              {pending ? "저장하는 중…" : "저장하기"}
            </button>
          ) : null}
          {(leg.added || leg.skipped) && !locked ? (
            <button
              type="button"
              onClick={restore}
              disabled={pending}
              className="border-primary text-primary flex h-11 w-full items-center justify-center rounded-lg border text-sm font-bold disabled:opacity-40"
            >
              {leg.skipped ? `평소대로 다시 ${leg.direction === "in" ? "타기" : "내리기"}` : `평소 ${verb} 곳으로 되돌리기`}
            </button>
          ) : null}
          {focused ? (
            <button
              type="button"
              onClick={showList}
              className="bg-card border-line flex h-11 w-full items-center justify-center rounded-lg border text-sm font-bold"
            >
              전체 회차 보기
            </button>
          ) : (
            <DialogClose className="bg-card border-line flex h-11 w-full items-center justify-center rounded-lg border text-sm font-bold">
              닫기
            </DialogClose>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
