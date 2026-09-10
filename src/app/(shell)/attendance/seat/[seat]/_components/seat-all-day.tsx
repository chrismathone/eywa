"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SEAT_DRAG_THRESHOLD_PX, seatMoveBlockReason } from "@/features/attendance/seat/placement";
import {
  resolveSeatPeriodChoices,
  seatChoiceKey,
  shouldAskSeatPin,
  validateSeatPeriodMove,
  type SeatPeriodMove,
  type SeatPeriodPin,
} from "@/features/attendance/seat/period-choice";
import {
  clearSeatPeriodChoices,
  moveSeatStudentPeriod,
} from "@/features/attendance/seat/server/period-actions";
import type { SeatKey } from "@/features/attendance/seat/seat";
import type { SeatPlacement } from "@/features/attendance/seat/placement";
import type { SeatClassRoster } from "@/features/attendance/seat/server/queries";
import { SeatBoard } from "./seat-board";
import { beginSeatDrag, endSeatDrag } from "./seat-drag";
import { SeatDragCard, type CardDrag, type SeatDropTarget } from "./seat-lab-grid";

/** 교시 하나를 그리는 데 필요한 재료 — 서버가 만들어 넘긴다(전부 직렬화 가능한 값). */
export type SeatAllDayPeriod = {
  start: string;
  rosters: SeatClassRoster[];
  prevAbsentByCell?: Readonly<Record<string, string>>;
  nextStartByStudent?: Readonly<Record<string, string>>;
  nextRoomByStudent?: Readonly<Record<string, string>>;
  placements: SeatPlacement[];
};

/** 반 묶음 이동 처리기 등록 — 교시별 판이 마운트하며 자기 것을 여기에 남긴다. */
type RegisterMove = (
  start: string,
  move: ((studentId: string, toClassId: string, homeClassId: string) => void) | null,
) => void;

/**
 * '전체' 보기의 **바깥 드래그 컨텍스트** — 교시를 건너는 이동은 여기서만 성립한다.
 *
 * 원장 2026-09-10: *"대신 그 시간 뒤로 드래그하면 정보 사라지게"* → *"한번 드래그한 학생은 '다음에도 이
 * LAB실 수업을 이 시간대로 고정할까요?'라고 물어볼것. 고정하면 그 학생은 계속 그 시간대에서 랩실 수업
 * 듣게."* → 근거 *"그 학생만 그 시간대에 어쩔 수 없는 사정으로 다른 학생과 다른 시간에 랩실을 듣는
 * 학생이 있어. 그래서 하루에 랩이 2회인 EiE 수업이 존재하는것."*
 *
 * 🔴 **교시마다 컨텍스트를 두면 교시를 건널 수 없다** — 그래서 `SeatBoard`는 `externalDnd`로 제 컨텍스트를
 *    끄고 반 묶음 이동 처리기만 여기 등록한다(구현은 여전히 그 훅 한 벌뿐이다).
 * 🔴 **드롭 한 번이 바꾸는 축은 하나**다 — 같은 교시의 다른 반이면 **배치**(0254a), 다른 교시의 **같은 반**
 *    이면 **교시 선택**(0255a). 다른 교시의 다른 반은 거절한다(한 동작에 두 축을 바꾸면 무엇이 바뀐 건지
 *    나중에 아무도 못 읽는다).
 * 🔴 **출결이 찍힌 카드는 애초에 안 잡힌다**(원장 *"출결이 찍힌 학생은 드래그 절대 불가"*) — 카드가
 *    손잡이를 끄고, 서버가 한 번 더 본다.
 */
export function SeatAllDay({
  seat,
  date,
  moves,
  pins,
  slotsByClass,
  markedSlotsByCell,
  canMove,
  periods,
  readOnly,
  hrefFor,
  canMovePlacement,
  placementNotice,
}: {
  seat: SeatKey;
  date: string;
  /** 서버가 준 그날 줄(0255a). 표가 없으면 빈 배열 — 화면은 지금까지 그대로다. */
  moves: readonly SeatPeriodMove[];
  pins: readonly SeatPeriodPin[];
  slotsByClass: Readonly<Record<string, readonly string[]>>;
  markedSlotsByCell: Readonly<Record<string, readonly string[]>>;
  /** 교시 이동·고정을 쓸 수 있나 — 로그인 + 쓰기 가능 + 0255a 적용됨. */
  canMove: boolean;
  /**
   * 그날 교시들 — 위에서 아래로 이어 붙인다(원장 *"스크롤링으로 시간대별로 분리해서"*).
   * 🔴 서버 컴포넌트에서 **함수를 내려보낼 수 없어**(직렬화 불가) 교시 재료를 값으로 받는다.
   */
  periods: SeatAllDayPeriod[];
  readOnly: boolean;
  hrefFor: string;
  /** 반 묶음 이동(배치, 0254a)을 쓸 수 있나 — 교시 선택과 **가용성이 따로**다. */
  canMovePlacement: boolean;
  placementNotice: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * 낙관 반영 — `반id|학생id` → 교시. 서버 왕복 전에도 카드가 곧바로 옮겨 간다.
   * 🔑 `null`은 "지정 없음"(= 모든 교시에 다시 선다)이라 [해제]도 이 한 모양으로 표현된다.
   */
  const [overlay, setOverlay] = useState<Record<string, string | null>>({});
  /** 교시별 반 묶음 이동 처리기 — 각 판이 마운트하며 등록한다. */
  const movesByPeriod = useRef(
    new Map<string, (studentId: string, toClassId: string, homeClassId: string) => void>(),
  );
  /** 드래그가 끝나고 물어볼 고정 — 원장 *"고정할까요?"*. */
  const [ask, setAsk] = useState<{
    studentId: string;
    classId: string;
    name: string;
    fromSlot: string;
    toSlot: string;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: SEAT_DRAG_THRESHOLD_PX } }),
  );

  const onRegisterMove = useCallback<RegisterMove>((start, move) => {
    if (move) movesByPeriod.current.set(start, move);
    else movesByPeriod.current.delete(start);
  }, []);

  /** 서버 줄을 그 날짜로 접고 낙관 오버레이를 얹는다 — 화면이 보는 선택의 **단일 소스**. */
  const periodChoices = useMemo(() => {
    const base = resolveSeatPeriodChoices({ moves, pins, date });
    for (const [key, slot] of Object.entries(overlay)) {
      if (slot === null) delete base[key];
      else base[key] = slot;
    }
    return base;
  }, [moves, pins, date, overlay]);

  /** 그 (반|학생)에 지금 걸린 상시 고정 — 같은 답을 두 번 묻지 않으려는 재료. */
  const pinnedSlotOf = useCallback(
    (classId: string, studentId: string) =>
      pins.find((p) => p.classId === classId && p.studentId === studentId && p.effectiveFrom <= date)
        ?.slotStart ?? null,
    [pins, date],
  );

  const commitPeriodMove = useCallback(
    (v: { studentId: string; classId: string; fromSlot: string; toSlot: string; pin: boolean }) => {
      setError(null);
      const key = seatChoiceKey(v.classId, v.studentId);
      setOverlay((m) => ({ ...m, [key]: v.toSlot }));
      startTransition(async () => {
        const res = await moveSeatStudentPeriod({ seat, date, ...v });
        if ("error" in res) {
          setOverlay((m) => {
            const next = { ...m };
            delete next[key];
            return next;
          });
          setError(res.error);
          return;
        }
        router.refresh();
      });
    },
    [date, router, seat],
  );

  const onClearPeriodChoices = useCallback(
    (classId: string) => {
      setError(null);
      // 낙관 반영은 **그 반의 지금 지정된 학생 전부** — 서버도 같은 범위를 지운다.
      setOverlay((m) => {
        const next = { ...m };
        for (const key of Object.keys(periodChoices)) {
          if (key.startsWith(`${classId}|`)) next[key] = null;
        }
        return next;
      });
      startTransition(async () => {
        const res = await clearSeatPeriodChoices({ seat, date, classId });
        if ("error" in res) {
          // 무엇이 남았는지 화면이 지어내지 않는다 — 오버레이를 걷고 서버 줄로 되돌린다.
          setOverlay({});
          setError(res.error);
          return;
        }
        router.refresh();
      });
    },
    [date, periodChoices, router, seat],
  );

  return (
    <DndContext
      id="seat-all-day"
      sensors={sensors}
      onDragStart={(e: DragStartEvent) => {
        beginSeatDrag();
        setDrag((e.active.data.current as CardDrag | undefined) ?? null);
      }}
      onDragCancel={() => {
        endSeatDrag();
        setDrag(null);
      }}
      onDragEnd={(e: DragEndEvent) => {
        endSeatDrag();
        const card = e.active.data.current as CardDrag | undefined;
        const to = e.over?.data.current as Partial<SeatDropTarget> | undefined;
        setDrag(null);
        // 🔴 집는 순간의 스냅샷이 비면 아무것도 하지 않는다([[#129]]: 끌던 줄이 언마운트되면 data가 빈다).
        if (!card || !to?.classId || !to.start) return;

        // ① 같은 교시 — 반 묶음 이동(배치). 구현은 그 교시 판의 훅 한 벌뿐이다.
        if (to.start === card.start) {
          if (to.classId === card.sectionClassId) return;
          movesByPeriod.current.get(card.start)?.(card.studentId, to.classId, card.homeClassId);
          return;
        }

        // ② 다른 교시 — **같은 반**일 때만 교시 선택. 화면이 먼저 거르고 서버가 다시 본다([[#77]]).
        const check = validateSeatPeriodMove({
          classId: card.homeClassId,
          toClassId: to.classId,
          fromSlot: card.start,
          toSlot: to.start,
          classSlots: slotsByClass[card.homeClassId] ?? [],
          // 잠긴 카드는 애초에 안 잡히지만 같은 함수를 한 번 더 태운다 — 두 사람이 같은 카드를
          // 열어 두면 한쪽이 찍는 사이 다른 쪽이 끌 수 있다(그 순간이 고아 행이 생기는 지점이다).
          markedReason: seatMoveBlockReason(card.marked ? "marked" : null),
        });
        if ("error" in check) {
          setError(check.error);
          return;
        }
        // 🔑 옮기는 것이 먼저다 — 창을 닫아도(=오늘만) 그날 이동은 이미 반영돼 있다.
        commitPeriodMove({
          studentId: card.studentId,
          classId: card.homeClassId,
          fromSlot: card.start,
          toSlot: to.start,
          pin: false,
        });
        if (
          shouldAskSeatPin({
            pinnedSlot: pinnedSlotOf(card.homeClassId, card.studentId),
            toSlot: to.start,
          })
        ) {
          setAsk({
            studentId: card.studentId,
            classId: card.homeClassId,
            name: card.name,
            fromSlot: card.start,
            toSlot: to.start,
          });
        }
      }}
    >
      {error ? (
        <p
          role="status"
          className="text-att-absent-ink bg-att-absent/30 border-att-absent shrink-0 rounded-xl border px-3 py-2 text-xs"
        >
          {error}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto">
        {periods.map((p, i) => (
          // 🔴 교시 판은 **줄어들지 않는다**(`shrink-0`) — 판 루트가 `flex-1 min-h-0`라 그대로 두면 교시 7개가
          //    화면 높이를 나눠 가지며 **각자 찌그러져 잘린다**(원장 제보 2026-09-10 *"전체로 했을때 스크롤
          //    있어야지. 무스크롤이라서 화면이 다 짤림"*). 넘치는 높이는 바깥 `overflow-auto`가 스크롤로 받는다.
          <div key={`${seat}|${date}|${p.start}`} className="shrink-0">
            <SeatBoard
              seat={seat}
              date={date}
              periods={[]}
              showChips={false}
              activeStart={p.start}
              rosters={p.rosters}
              readOnly={readOnly}
              hrefFor={hrefFor}
              prevAbsentByCell={p.prevAbsentByCell}
              nextStartByStudent={p.nextStartByStudent}
              nextRoomByStudent={p.nextRoomByStudent}
              placements={p.placements}
              canMove={canMovePlacement}
              // 배너는 맨 위 교시에만 — 교시마다 같은 문장이 서면 화면이 경고로 덮인다.
              placementNotice={i === 0 ? placementNotice : null}
              periodChoices={periodChoices}
              slotsByClass={slotsByClass}
              markedSlotsByCell={markedSlotsByCell}
              onClearPeriodChoices={canMove ? onClearPeriodChoices : undefined}
              externalDnd
              onRegisterMove={onRegisterMove}
              canChoosePeriod={canMove}
            />
          </div>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{drag ? <SeatDragCard drag={drag} /> : null}</DragOverlay>

      {/* 🔴 창은 **고정만** 묻는다 — 그날 이동은 이미 됐다. 닫아도 안 되돌아가는 이유를 문장이 말한다. */}
      {ask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="bg-card shadow-card w-full max-w-sm rounded-2xl p-4">
            <p className="text-foreground text-sm font-bold">
              다음에도 이 자리 수업을 {ask.toSlot}로 고정할까요?
            </p>
            <p className="text-text-dim mt-2 text-xs leading-relaxed">
              {ask.name} 학생을 {ask.fromSlot} → {ask.toSlot}로 옮겼습니다(오늘 명단에 이미 반영됨).
              고정하면 앞으로 같은 요일에는 {ask.toSlot} 명단에만 섭니다. 지난 날짜와 출결 기록은 바뀌지
              않습니다.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAsk(null)}
                className="border-line text-text-dim rounded-lg border px-3 py-1.5 text-xs font-semibold"
              >
                오늘만
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  commitPeriodMove({
                    studentId: ask.studentId,
                    classId: ask.classId,
                    fromSlot: ask.fromSlot,
                    toSlot: ask.toSlot,
                    pin: true,
                  });
                  setAsk(null);
                }}
                className="bg-primary text-primary-foreground rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                앞으로도 고정
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DndContext>
  );
}
