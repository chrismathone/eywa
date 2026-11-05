"use client";

import { useCallback, useMemo, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SEAT_DRAG_THRESHOLD_PX, type SeatPlacement } from "@/features/attendance/seat/placement";
import { seatDropVerdict, type SeatDropInputs } from "@/features/attendance/seat/drop-verdict";
import {
  applySeatPeriodChoicesByPeriod,
  blankSeatCell,
  resolveSeatPeriodChoices,
  seatChoiceKey,
  shouldAskSeatPin,
  type SeatPeriodMove,
  type SeatPeriodPin,
} from "@/features/attendance/seat/period-choice";
import { clearSeatPeriodChoices, moveSeatStudentPeriod } from "@/features/attendance/seat/server/period-actions";
import type { SeatKey } from "@/features/attendance/seat/seat";
import type { SeatClassRoster, SeatStudent } from "@/features/attendance/seat/server/queries";
import type { SeatStudentClass } from "@/features/attendance/seat/student-classes";
import { SeatBoard, type SeatReadOnlyReason } from "./seat-board";
import { useSeatChoiceOverlay } from "./seat-board-moves";
import { beginSeatDrag, endSeatDrag } from "./seat-drag";
import type { CardDrag, SeatDropTarget } from "./seat-lab-grid";
import { SeatPeriodChips, SEAT_ALL_PERIODS } from "./seat-period-chips";
import {
  SeatAllDayDragOverlay,
  SeatDragProvider,
  SeatDropChip,
  SeatPeriodDropZone,
  seatDropCollision,
  type SeatVerdictOf,
} from "./seat-drop-zones";
import {
  beginSeatPinClear,
  beginSeatPinMove,
  closeSeatPinAsk,
  noteSeatMove,
  SeatPinAskHost,
  settleSeatPinMove,
  useSeatPinView,
} from "./seat-pin-ask";
import { seatPinTargetOf, type SeatPinAsk, type SeatPinTarget } from "./seat-pin-ledger";

/** 교시 하나를 그리는 데 필요한 재료 — 서버가 만들어 넘긴다(전부 직렬화 가능한 값). */
export type SeatAllDayPeriod = {
  start: string;
  /** 이 교시의 끝 시각들(`SeatPeriod.ends`) — 학생 축 겹침 판정의 구간 끝. */
  ends: string[];
  /** 이 교시에 걸린 반들 — 교시 칩의 "N개 반"(칩 줄과 같은 값). */
  classIds: string[];
  /** 교시 선택을 **얹기 전** 명단 — 낙관 반영이 감추기와 되살리기를 함께 해야 해서 원본을 받는다. */
  rosters: SeatClassRoster[];
  prevAbsentByCell?: Readonly<Record<string, string>>;
  nextStartByStudent?: Readonly<Record<string, string>>;
  nextRoomByStudent?: Readonly<Record<string, string>>;
  /** 이 교시가 오늘 마지막 수업이라고 **확인된** 학생 — 없으면 '마지막 수업'을 안 적는다(모름 ≠ 없음). */
  lastByStudent?: Readonly<Record<string, true>>;
  placements: SeatPlacement[];
};

/** 하루치 교시 선택·이동 판정 재료 — 서버 줄 + `SeatDay`의 네 칸 + 학생 축(전부 직렬화 가능한 값). */
export type SeatChoiceDay = {
  /** 서버가 준 그날 줄(0255a). 표가 없으면 빈 배열 — 화면은 지금까지 그대로다. */
  moves: readonly SeatPeriodMove[];
  pins: readonly SeatPeriodPin[];
  slotsByClass: Readonly<Record<string, readonly string[]>>;
  markedSlotsByCell: Readonly<Record<string, readonly string[]>>;
  busyStartsByClass: Readonly<Record<string, readonly string[]>>;
  offSlotByCell: Readonly<Record<string, Readonly<Record<string, SeatStudent>>>>;
  /** LAB '따로 수업(*LAB)' 학생 배정(0271b) — 선택이 없을 때 설 교시들. 없으면 종전 그대로. */
  defaultSlotsByCell?: Readonly<Record<string, readonly string[]>>;
  /**
   * 학생 축(원장 2026-09-11 이후) — 학생 id → 그날 이 자리 밖 수업(다음 행선지 조회와 같은 하루치, 새 왕복 0).
   * 없거나 그 학생 키가 없으면(모름) 화면은 이 축으로 막지 않는다 — 서버가 자기 조회로 다시 본다.
   */
  studentClasses?: Readonly<Record<string, readonly SeatStudentClass[]>>;
};

/** 교시 호출 한 번의 재료 — 과녁(자리|날짜|반|학생) + 어디서 어디로 + 고정 여부. */
type SeatPeriodCall = SeatPinTarget & { fromSlot: string; toSlot: string; pin: boolean };

const NO_ASKS: readonly SeatPinAsk[] = [];

/**
 * 랩실 로그인 자리 출석부의 **드래그 컨텍스트 한 벌** — '교시 하나' 보기와 '전체' 보기가 모두 이것이다.
 *
 * 원장 2026-09-10: *"내가 원한건, 같은 시간 내에서 이동하는게 아니라 "다른 시간"으로 이동하고 싶은것."* · *"다른시간으로
 * 옮기는게 목적. 같은 시간은 의미없음."* → 2026-09-11: *"LAB실에서 내가 드래그하고 싶은건, '다른 시간대'의 수업임. 같은
 * 시간대의 수업으로 옮기고 싶은게 아니야."* · *"아니 드래그는 '전체' 에서도 다른 시간으로 이동하려고하면 경고 문구 뜨면서
 * 안됨"*.
 *
 * 🔑 **드래그의 뜻은 하나 = 다른 시간으로.** 놓을 곳 = 교시 칩(두 보기 모두 — 긴 스크롤 없이) + '전체' 보기의 교시 판.
 *    그 교시의 어디에 놓든 그 학생은 그 교시에 선다(제 반 이름의 옮겨 온 묶음으로 — 출결이 원래 반으로 저장되므로).
 *    같은 교시에 놓으면 **아무 일도 없다**(제자리 = 취소). 같은 교시 안 반 묶음 이동(배치 0254a 드래그)은 없앴다 —
 *    이미 옮겨 둔 줄의 표시·[초기화]만 남는다(`useSeatPlacementMoves`).
 * 🔑 **'교시 하나' 보기도 판정은 하루치**다 — 보이는 교시 하나만 그리되 명단·선택은 그날 전 교시로 접는다(서버가 이미
 *    하루치 `rosterByPeriod`·선택을 넘긴다, 새 조회 0). 그래야 칩에 놓아 옮긴 학생이 그 교시에 서고 여기선 빠진다.
 * 🔴 **판정 한 벌** — 집는 순간 놓을 곳마다 칠하는 표식 · 끄는 카드 아래 문장 · 드롭 거절이 전부 `verdictOf`
 *    (`seatDropVerdict` → 서버와 같은 `validateSeatPeriodMove`)를 쓴다. 둘이 갈리면 거짓 안내다.
 * 🔴 **출결이 찍힌 카드는 애초에 안 잡힌다**(원장 *"출결이 찍힌 학생은 드래그 절대 불가"*) — 카드가 손잡이를 끄고,
 *    판정이 한 번 더, 서버가 또 한 번 본다.
 * ⚠️ 끄는 상태를 여기(state)에 두지 않는다 — 두면 집는 순간 교시 판 전부가 다시 그려진다(`seat-drop-zones.tsx`).
 */
export function SeatAllDay({
  seat,
  date,
  choiceDay,
  canMove,
  periods,
  shownStart = null,
  showAll,
  readOnly,
  readOnlyReason,
  hrefFor,
  canMovePlacement,
  placementNotice,
}: {
  seat: SeatKey;
  date: string;
  /** 하루치 교시 선택·이동 판정 재료(선택 줄·제 교시·기록·다른 수업 시각·옮겨 가서 찍힌 칸·학생 축). */
  choiceDay: SeatChoiceDay;
  /** 교시 이동·고정을 쓸 수 있나 — 로그인 + 쓰기 가능 + 0255a 적용됨. 거짓이면 카드가 안 잡힌다(공개 PIN·지난 날짜). */
  canMove: boolean;
  /**
   * 그날 교시들 — **전부** 받는다('교시 하나' 보기여도 판정이 하루치라서).
   * 🔴 서버 컴포넌트에서 **함수를 내려보낼 수 없어**(직렬화 불가) 교시 재료를 값으로 받는다.
   */
  periods: SeatAllDayPeriod[];
  /** 그릴 교시 — null이면 '전체'(원장 *"스크롤링으로 시간대별로 분리해서"*), 값이면 그 교시 하나. */
  shownStart?: string | null;
  /** 칩 줄에 '전체'를 세울 것인가(랩실만). */
  showAll: boolean;
  readOnly: boolean;
  /** 보기만인 이유 — 보드가 안내 문장·칸 모양을 가른다(`SeatReadOnlyReason`). 생략 = 지난 날짜. */
  readOnlyReason?: SeatReadOnlyReason;
  hrefFor: string;
  /** 이미 옮겨 둔 자리(배치, 0254a)를 [초기화]할 수 있나 — 교시 이동과 **가용성이 따로**다. */
  canMovePlacement: boolean;
  placementNotice: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const { moves, pins } = choiceDay;
  /**
   * 고정 질문 줄 + 에러 한 줄 — **이 화면 state가 아니라 가게**([`seat-pin-ask.tsx`](./seat-pin-ask.tsx))에 있다.
   * 🔴 질문은 서버가 받아 준 **뒤에** 선다 — 그 사이 교시 칩·날짜 화살표를 눌러 이 화면이 새로 마운트돼도 응답은 가게에
   *    남는다(state였을 땐 대기열째 버려져 '고정할까요?'가 끝내 안 떴다, 적대 리뷰 2026-09-11). 줄은 대기열이고 창엔 맨 앞
   *    하나 · 끄는 동안엔 안 뜬다 · (자리|날짜|반|학생)마다 마지막 호출만 화면을 정한다 — 규칙은 [`seat-pin-ledger.ts`](./seat-pin-ledger.ts).
   * 🔑 에러는 **이 화면의 날**에 선 것만 보인다(다른 날로 가서 받은 거절은 그날로 돌아오면 선다).
   */
  const { asks, note } = useSeatPinView();
  const error = note && note.seat === seat && note.date === date ? note.text : null;
  const setError = useCallback(
    (text: string | null) => noteSeatMove(text === null ? null : { seat, date, text }),
    [date, seat],
  );
  /** 창에 띄울 질문 — 이 자리 것만(다른 날 것이면 창이 그 날짜를 적는다). 옮기기가 잠긴 화면(공개 PIN·지난 날짜)엔 없다. */
  const shownAsks = useMemo(() => (canMove ? asks.filter((a) => a.seat === seat) : NO_ASKS), [asks, canMove, seat]);
  /**
   * 낙관 반영 — `반id|학생id` → 교시. 서버 왕복 전에도 카드가 곧바로 옮겨 간다.
   * 🔑 `null`은 "지정 없음"(= 제 교시에 다시 선다)이라 [해제]도 이 한 모양으로 표현된다.
   * 🔴 새 서버 줄이 오면 비워진다(`useSeatChoiceOverlay`) — 남겨 두면 다른 창이 푼 지정을 이 화면만 붙든다.
   */
  const [overlay, setOverlay] = useSeatChoiceOverlay(moves, pins);
  /** 교시 판들을 담는 상자 — 놓을 곳 판정이 판을 **이 상자 안(보이는 자리)에서만** 받는다(`seatDropCollision`). */
  const boardsRef = useRef<HTMLDivElement | null>(null);
  const collision = useCallback<CollisionDetection>((args) => seatDropCollision(args, boardsRef.current), []);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: SEAT_DRAG_THRESHOLD_PX } }),
  );

  /** 서버 줄을 그 날짜로 접고 낙관 오버레이를 얹는다 — 화면이 보는 선택의 **단일 소스**. */
  const periodChoices = useMemo(() => {
    const base = resolveSeatPeriodChoices({ moves, pins, date });
    for (const [key, slot] of Object.entries(overlay)) {
      if (slot === null) delete base[key];
      else base[key] = slot;
    }
    return base;
  }, [moves, pins, date, overlay]);

  /**
   * 하루 명단에 선택을 얹는다 — 서버 쓰기 경로(`rosterKeys`)와 **같은 순수 함수**다. 여기서만 낙관 오버레이가
   * 섞인다(그래서 원본 명단을 받아 매번 다시 접는다 — 감춘 명단만 들고 있으면 [해제] 때 되살릴 재료가 없다).
   */
  const appliedByPeriod = useMemo(
    () =>
      applySeatPeriodChoicesByPeriod(
        Object.fromEntries(periods.map((p) => [p.start, p.rosters])),
        {
          choices: periodChoices,
          slotsByClass: choiceDay.slotsByClass,
          markedSlotsByCell: choiceDay.markedSlotsByCell,
          busyStartsByClass: choiceDay.busyStartsByClass,
          offSlotByCell: choiceDay.offSlotByCell,
          defaultSlotsByCell: choiceDay.defaultSlotsByCell,
          blank: blankSeatCell,
        },
      ),
    [periods, periodChoices, choiceDay],
  );

  /** 그 (반|학생)에 지금 걸린 상시 고정 — 같은 답을 두 번 묻지 않으려는 재료. */
  const pinnedSlotOf = useCallback(
    (classId: string, studentId: string) =>
      pins.find((p) => p.classId === classId && p.studentId === studentId && p.effectiveFrom <= date)
        ?.slotStart ?? null,
    [pins, date],
  );

  /** 판정 재료 — 전부 이미 받은 하루치다(새 조회 0). */
  const verdictInputs = useMemo<SeatDropInputs>(
    () => ({
      canMove,
      periodStarts: periods.map((p) => p.start),
      endsByStart: Object.fromEntries(periods.map((p) => [p.start, p.ends])),
      slotsByClass: choiceDay.slotsByClass,
      busyStartsByClass: choiceDay.busyStartsByClass,
      studentClasses: choiceDay.studentClasses,
    }),
    [canMove, periods, choiceDay],
  );
  /** 드래그 한 번의 가부 — 놓을 곳 표식·끄는 카드 문장·드롭 거절이 **이 함수 하나**를 쓴다. */
  const verdictOf = useCallback<SeatVerdictOf>(
    (card, toSlot) => seatDropVerdict(card, toSlot, verdictInputs),
    [verdictInputs],
  );

  /**
   * 교시 이동 한 번 — 낙관 반영 후 서버. 🔑 고정 질문(`askAfter`)은 **서버가 받아 준 뒤에** 선다 — 창 문장이 "옮겼습니다
   * (오늘 명단에 이미 반영됨)"라, 먼저 띄우면 거절된 이동을 옮겼다고 말하고 '앞으로도 고정'이 같은 이동을 다시 보낸다.
   * 🔴 호출하는 순간 그 과녁의 앞선 질문은 **숨는다**(지우지 않는다 — 이 호출이 거절되면 서버에 남은 앞 이동의 질문이
   *    돌아온다). 응답은 **그 과녁의 마지막 호출일 때만** 질문을 싣고 낙관 반영을 되돌린다(`settleSeatPinMove`).
   * 🔑 과녁의 자리·날짜는 호출이 싣는다 — 다른 날 화면에서 답한 고정은 **그날로** 가고, 이 화면 명단(낙관 반영)은 안 건드린다.
   */
  const commitPeriodMove = useCallback(
    (v: SeatPeriodCall, askAfter: SeatPinAsk | null) => {
      setError(null);
      const target = seatPinTargetOf(v);
      const key = seatChoiceKey(v.classId, v.studentId);
      const here = v.seat === seat && v.date === date;
      const seq = beginSeatPinMove(target);
      if (here) setOverlay((m) => ({ ...m, [key]: v.toSlot }));
      startTransition(async () => {
        const res = await moveSeatStudentPeriod({
          seat: v.seat,
          date: v.date,
          studentId: v.studentId,
          classId: v.classId,
          fromSlot: v.fromSlot,
          toSlot: v.toSlot,
          pin: v.pin,
        });
        const failed = "error" in res;
        // 그 사이 같은 학생을 또 옮겼거나 그 반을 [해제]했으면 이 응답은 옛 것이다 — 화면(질문·낙관 반영)은 뒤 호출이 정한다.
        const latest = settleSeatPinMove(target, seq, failed ? { ok: false } : { ok: true, ask: askAfter });
        if (failed) {
          if (latest && here) {
            setOverlay((m) => {
              const next = { ...m };
              delete next[key];
              return next;
            });
          }
          setError(res.error);
          return;
        }
        router.refresh();
      });
    },
    [date, router, seat, setError, setOverlay],
  );

  const onClearPeriodChoices = useCallback(
    (classId: string) => {
      setError(null);
      // 🔴 그 반의 질문은 이제 거짓일 수 있다(지정이 풀린다) — 숨기고, 아직 오는 중인 앞 이동의 응답도 옛 것으로 만든다.
      //    [해제]가 거절되면 숨긴 질문이 돌아온다(지정이 그대로 남았으니까).
      const calls = beginSeatPinClear({ seat, date, classId });
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
        const failed = "error" in res;
        for (const c of calls) settleSeatPinMove(c.target, c.seq, failed ? { ok: false } : { ok: true, ask: null });
        if (failed) {
          // 무엇이 남았는지 화면이 지어내지 않는다 — 오버레이를 걷고 서버 줄로 되돌린다.
          setOverlay({});
          setError(res.error);
          return;
        }
        router.refresh();
      });
    },
    [date, periodChoices, router, seat, setError, setOverlay],
  );

  const onDragEnd = (e: DragEndEvent) => {
    endSeatDrag();
    const card = e.active.data.current as CardDrag | undefined;
    const to = e.over?.data.current as Partial<SeatDropTarget> | undefined;
    // 🔴 집는 순간의 스냅샷이 비면 아무것도 하지 않는다([[#129]]: 끌던 줄이 언마운트되면 data가 빈다).
    if (!card?.studentId || !to?.start) return;
    const verdict = verdictOf(card, to.start);
    // 🔴 같은 시간 = 제자리 — 아무것도 안 바꾼다(원장 *"같은 시간은 의미없음"*). 막힌 게 아니라 취소라 에러도 없다.
    if (verdict.kind === "same") return;
    // 화면이 먼저 거르고 서버가 다시 본다([[#77]]) — 끄는 동안 칠한 빗금·문장과 **같은 문장**이다.
    if (verdict.kind === "blocked") {
      setError(verdict.text);
      return;
    }
    const ask: SeatPinAsk = {
      seat,
      date,
      studentId: card.studentId,
      classId: card.homeClassId,
      name: card.name,
      fromSlot: card.start,
      toSlot: to.start,
    };
    // 🔑 옮기는 것이 먼저다 — 창을 닫아도(=오늘만) 그날 이동은 이미 반영돼 있다(창은 서버가 받아 준 뒤에 뜬다).
    commitPeriodMove(
      { ...seatPinTargetOf(ask), fromSlot: ask.fromSlot, toSlot: ask.toSlot, pin: false },
      shouldAskSeatPin({ pinnedSlot: pinnedSlotOf(card.homeClassId, card.studentId), toSlot: to.start }) ? ask : null,
    );
  };

  /** 교시 판 한 장 — 두 보기가 같은 보드를 같은 인자로 그린다. */
  const board = (p: SeatAllDayPeriod, first: boolean) => (
    <SeatBoard
      seat={seat}
      date={date}
      periods={[]}
      showChips={false}
      activeStart={p.start}
      rosters={appliedByPeriod[p.start] ?? p.rosters}
      readOnly={readOnly}
      readOnlyReason={readOnlyReason}
      hrefFor={hrefFor}
      prevAbsentByCell={p.prevAbsentByCell}
      nextStartByStudent={p.nextStartByStudent}
      nextRoomByStudent={p.nextRoomByStudent}
      lastByStudent={p.lastByStudent}
      placements={p.placements}
      canMove={canMovePlacement}
      // 배너는 맨 위 교시에만 — 교시마다 같은 문장이 서면 화면이 경고로 덮인다.
      placementNotice={first ? placementNotice : null}
      periodChoices={periodChoices}
      // 🔑 위에서 이미 하루치로 얹었다 — 보드가 이 교시 명단만 가지고 다시 거르면 옮겨 온 학생이 사라진다.
      choicesApplied
      onClearPeriodChoices={canMove ? onClearPeriodChoices : undefined}
      canChoosePeriod={canMove}
    />
  );
  const shown = shownStart === null ? periods : periods.filter((p) => p.start === shownStart);

  return (
    <DndContext
      id="seat-all-day"
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={() => beginSeatDrag()}
      onDragCancel={() => endSeatDrag()}
      onDragEnd={onDragEnd}
    >
      <SeatDragProvider verdictOf={canMove ? verdictOf : null}>
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* 🔑 칩 줄 = **놓을 곳**(두 보기 모두) — 긴 스크롤 없이 다른 시간으로 옮길 자리. 누르면 여전히 그 교시로 간다. */}
          <SeatPeriodChips
            periods={periods}
            activeStart={shownStart ?? SEAT_ALL_PERIODS}
            hrefFor={hrefFor}
            showAll={showAll}
            Chip={canMove ? SeatDropChip : undefined}
          />
          {error ? (
            <p
              role="status"
              className="text-att-absent-ink bg-att-absent/30 border-att-absent shrink-0 rounded-xl border px-3 py-2 text-xs"
            >
              {error}
            </p>
          ) : null}
          {/* 🔴 교시 판들은 **한 상자**(`boardsRef`)에 담는다 — 놓을 곳 판정이 판을 이 상자 안(= 보이는 자리)에서만 받는다
              (`seatDropCollision`: 스크롤로 가려진 판이 칩 줄 위에서 잡히던 것). '전체'면 이 상자가 스크롤을 받고, 교시
              하나면 판이 남는 높이를 받아 안에서 스크롤한다(종전 교시 하나 보기와 같은 모양). */}
          <div
            ref={boardsRef}
            data-seat-boards=""
            className={`flex min-h-0 flex-1 flex-col ${shownStart === null ? "gap-4 overflow-auto" : ""}`}
          >
            {shown.map((p, i) => (
              // 🔴 '전체'에선 교시 판이 **줄어들지 않는다**(`shrink-0`) — 판 루트가 `flex-1 min-h-0`라 그대로 두면 교시 7개가
              //    화면 높이를 나눠 가지며 **각자 찌그러져 잘린다**(원장 제보 2026-09-10 *"전체로 했을때 스크롤
              //    있어야지. 무스크롤이라서 화면이 다 짤림"*). 넘치는 높이는 이 상자의 `overflow-auto`가 스크롤로 받는다.
              <SeatPeriodDropZone
                key={`${seat}|${date}|${p.start}`}
                start={p.start}
                className={shownStart === null ? "shrink-0" : "flex min-h-0 flex-1 flex-col"}
              >
                {board(p, i === 0)}
              </SeatPeriodDropZone>
            ))}
          </div>
        </div>
        <SeatAllDayDragOverlay />

        {/* 창은 줄의 맨 앞 하나 · 끄는 동안엔 안 뜬다(`SeatPinAskHost`). 답하면 **본 그 질문**만 빠지고 다음 질문이 선다. */}
        <SeatPinAskHost
          asks={shownAsks}
          date={date}
          pending={pending}
          onClose={closeSeatPinAsk}
          // 고정만 더하는 호출 — 창은 이미 떠 있으니 다시 묻지 않는다(`null`). 🔴 **그 질문의 자리·날짜로** 보낸다 — 그 사이
          // 날짜를 옮겼으면 이 화면의 날짜로 보내 그날에는 없던 이동·고정을 만든다. 답한 질문은 호출이 숨기고(거절되면 돌아온다)
          // 받아지면 버린다(`beginSeatPinMove`).
          onPin={(ask) =>
            commitPeriodMove({ ...seatPinTargetOf(ask), fromSlot: ask.fromSlot, toSlot: ask.toSlot, pin: true }, null)
          }
        />
      </SeatDragProvider>
    </DndContext>
  );
}
