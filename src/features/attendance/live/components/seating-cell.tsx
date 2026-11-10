"use client";

import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useSeatingCanEdit } from "./seating-edit-context";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import { fluidNameFontSize, NAME_FILL_MAX_PX, NAME_FILL_MIN_PX } from "@/features/attendance/seat/name-fit";
import { attendanceCheckMark, isDeskIntakeNote, seatRecorderName } from "../check-time";
import {
  canDeskMark,
  seatHoverTitle,
  seatMarkOf,
  SEAT_MARK_INK,
  SEAT_MARK_TONE,
} from "../mark-state";
import type { SeatingClass, SeatingStudent } from "../seating";

const MARKS = [
  { status: "present" as const, label: "출석" },
  { status: "late" as const, label: "지각" },
  { status: "absent" as const, label: "결석" },
];

/** 겹판이 앵커·화면 가장자리와 두는 간격(px) — 위치 계산 한 곳에서만 쓴다. */
const POP_GAP = 4;
const POP_EDGE = 8;

/**
 * 칸 아래에 뜨는 겹판(출결 메뉴·오류) — **포털로 `document.body`에 붙인다.**
 *
 * 🔴 반 카드([`seating-room.tsx`](./seating-room.tsx)의 `<article>`)에 `overflow-hidden`이 걸려 있어
 *    (머리 색띠가 둥근 모서리 밖으로 새지 않게) 칸 안에서 `absolute`로 띄우면 **카드 경계에서 잘린다**.
 *    아랫줄 학생일수록 메뉴가 통째로 안 보여 출결을 못 찍었다(원장 제보 2026-09-04). 카드의 overflow를
 *    푸는 건 머리띠가 깨지므로 **겹판만 카드 밖으로 꺼낸다**(시간표 hover 카드와 같은 규약).
 * 🔑 위치는 앵커(칸 버튼)의 화면 좌표 + `position: fixed`라 조상 overflow와 무관하다. 대신 **스크롤·
 *    리사이즈 때마다 다시 잰다** — 안 재면 칸은 움직이는데 겹판만 제자리에 남아 엉뚱한 칸 위에 뜬다.
 * 🔑 오른쪽 끝 칸은 왼쪽으로, 아래 공간이 모자라면 **칸 위로 뒤집는다**(3열 격자의 오른쪽 칸·화면 맨
 *    아랫줄에서 창 밖으로 나가던 자리).
 * ⚠️ 위치를 재기 전에는 **투명 + 클릭 통과**다 — 첫 프레임에 (0,0)으로 번쩍이지 않게 하되, 안 보이는
 *    판이 화면 왼쪽 위에서 클릭을 가로채지 않게 한다.
 */
function CellPopover({
  anchorRef,
  onClose,
  children,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>;
  /** 바깥을 누르거나 Esc — 여러 칸의 메뉴가 동시에 떠 있지 않게. 없으면 스스로 안 닫힌다(오류 문구). */
  onClose?: () => void;
  children: ReactNode;
}) {
  const popRef = useRef<HTMLDivElement | null>(null);
  /**
   * 위치를 재기 전 한 프레임은 안 보이게 둔다.
   * 🔴 감추는 수단은 **`opacity`여야 한다** — `visibility: hidden`·`display: none`인 요소는 초점을 못
   *    받아서, 그 프레임에 걸리는 자동 초점(아래 메뉴 첫 항목)이 조용히 무시된다. 투명도는 자리와
   *    초점을 그대로 두고 그림만 감춘다.
   */
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const pop = popRef.current?.getBoundingClientRect();
    if (!anchor || !pop) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    /**
     * 🔴 앵커가 스크롤돼 화면 밖으로 나갔으면 겹판을 **치운다** — 가장자리에 클램프된 채로 남으면
     *    이미 안 보이는 학생의 메뉴가 **다른 반 카드 위에서** 눌린다(엉뚱한 학생 출결).
     * ⚠️ 크기 0인 rect는 "화면 밖"이 아니라 **잴 수 없는 것**이다(테스트 환경·숨김) — 판단하지 않는다.
     */
    const measurable = anchor.width > 0 || anchor.height > 0;
    if (
      measurable &&
      (anchor.bottom <= 0 || anchor.top >= vh || anchor.right <= 0 || anchor.left >= vw)
    ) {
      if (onClose) onClose();
      else setPos(null); // 스스로 안 닫히는 겹판(오류)은 숨겼다가 되돌아오면 다시 뜬다
      return;
    }
    let left = anchor.left;
    if (left + pop.width > vw - POP_EDGE) left = vw - POP_EDGE - pop.width;
    if (left < POP_EDGE) left = POP_EDGE;
    let top = anchor.bottom + POP_GAP;
    if (top + pop.height > vh - POP_EDGE) {
      const above = anchor.top - POP_GAP - pop.height;
      top = above >= POP_EDGE ? above : Math.max(POP_EDGE, vh - POP_EDGE - pop.height);
    }
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }));
  }, [anchorRef, onClose]);

  /**
   * 🔑 위치는 **ref 콜백**에서 잰다 — 이 리포는 effect 안 setState를 금지한다([[#25]]).
   *    ref 콜백은 커밋 단계라 페인트 전에 재고, 그 자리에서 상태를 맞출 수 있다.
   */
  const attach = useCallback(
    (el: HTMLDivElement | null) => {
      popRef.current = el;
      if (el) place();
    },
    [place],
  );

  useEffect(() => {
    // capture=true — 창 안 스크롤 컨테이너(`main.overflow-auto`)의 스크롤까지 잡는다.
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [place]);

  useEffect(() => {
    if (!onClose) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      // 앵커를 다시 누른 것은 버튼의 토글이 처리한다(여기서 닫으면 곧바로 다시 열려 깜빡인다).
      if (anchorRef.current?.contains(t) || popRef.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
      // 초점을 칸으로 되돌린다 — 겹판이 사라지면 초점이 body로 떨어져 키보드 흐름이 끊긴다.
      anchorRef.current?.focus();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={attach}
      className={`fixed z-[9999] ${pos ? "" : "pointer-events-none"}`}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, opacity: pos ? undefined : 0 }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** 방금 누른 값 — 상태와 **찍은 시각**이 한 덩어리다(따로 두면 되돌릴 때 한쪽만 남는다). */
type Optimistic = { status: string; at: string };

export function SeatingCell({
  date,
  klass,
  student,
  /**
   * 학생 검색에 걸린 칸 — **색이 아니라 테두리**로 짚는다. 칸 색은 출결 상태(SEAT_MARK_TONE)가 쓰는
   * 자리라 여기에 색을 얹으면 "이 학생은 무슨 상태인가"를 덮어 버린다.
   */
  found = false,
}: {
  date: string;
  klass: SeatingClass;
  student: SeatingStudent;
  found?: boolean;
}) {
  const boardEditable = useSeatingCanEdit();
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * 방금 누른 값 — **상태와 시각을 한 덩어리로** 들고 있는다. 따로 두면 저장이 실패해 되돌릴 때
   * 한쪽만 되돌아가(옛 상태 + 방금 시각) 화면이 거짓말을 한다.
   */
  const [optimistic, setOptimistic] = useState<Optimistic | null>(null);
  /**
   * **서버가 따라잡으면 낙관값을 버린다** — `student.recordedAt`이 바뀐 순간이 곧 `router.refresh()`가
   * 도착한 순간이다. 이걸 안 하면 낙관값이 영영 남아 ① 그 칸의 시각이 세션 내내 **클라 시계값**으로
   * 굳고 ② 남이 뒤이어 고쳐도 이 화면만 옛 값을 붙들며 ③ 입력자 이름이 계속 숨겨진다.
   *
   * 🔴 **`useTransition`의 `isPending`에 기대면 안 된다**: `startTransition`에 넘긴 콜백이 동기 함수라
   *    (promise를 반환하지도, await 하지도 않는다) 트랜지션 스코프가 그 자리에서 끝난다 — 저장이 오가는
   *    동안 `busy`는 이미 false다. 같은 사실이 [quick-board](../../quick/components/quick-board.tsx)에도
   *    적혀 있다(*"있지도 않은 transition에 기대지 않는다"*).
   * 🔑 effect가 아니라 **렌더 중 조정**이다(React 공식 "props가 바뀔 때 state 맞추기"). 이 리포는
   *    effect 안 setState를 금지한다([[#25]]).
   * ⚠️ 낙관값이 없을 때도 추적값을 갱신한다 — 안 그러면 남이 고친 뒤 내가 처음 누르는 순간
   *    "props가 옛 추적값과 다르다"가 되어 방금 누른 값이 **그 자리에서** 지워진다.
   */
  const serverAt = student.recordedAt ?? null;
  const [seenServerAt, setSeenServerAt] = useState<string | null>(serverAt);
  if (serverAt !== seenServerAt) {
    setSeenServerAt(serverAt);
    if (optimistic) setOptimistic(null);
  }
  const status = optimistic ? optimistic.status : student.status;
  const recordedAt = optimistic ? optimistic.at : serverAt;
  const mark = seatMarkOf(status, klass.phase);
  /**
   * 이름 아래에 붙일 체크 시각(원장 2026-08-21). 기록이 없으면 null = **아래 줄을 안 그린다**
   * (빈 자리가 곧 "아직 안 찍음"이다). 수업일과 다른 날 찍었으면 날짜가 함께 온다([`check-time.ts`](../check-time.ts)).
   *
   * 🔴 **데스크 접수건은 시각을 안 남긴다**(원장 2026-08-24) — 학부모 전화를 미리 받아 처리한 결석이라
   *    "이 시각에 교실에서 확인했다"가 아니다. 단 방금 내가 누른 칸(낙관)은 진짜 지금 찍은 것이므로
   *    옛 메모가 남아 있어도 시각을 보여 준다.
   */
  const check =
    !optimistic && isDeskIntakeNote(student.note)
      ? null
      : attendanceCheckMark(recordedAt, date, klass.firstEnd);
  /**
   * 담임(카드에 이름이 적힌 사람)이 아닌 사람이 찍었을 때만 그 이름.
   *
   * 🔑 **낙관값이 떠 있는 동안만** 비운다 — 내 이름을 지어내면 화면이 "저장됐다"고 단정하는 셈이고,
   *    옛 이름을 그대로 두면 방금 바뀐 시각 옆에 **이전에 찍은 사람** 이름이 붙어 거짓말이 된다
   *    (데스크가 찍어 둔 칸을 담임이 다시 찍는 흔한 경우에 바로 재현된다).
   * 🔑 낙관값은 위 렌더-타임 조정이 서버 도착과 함께 버리므로, 그 뒤엔 진짜 입력자가 곧바로 뜬다.
   */
  const recorder = optimistic
    ? null
    : seatRecorderName({
        recordedBy: student.recordedBy,
        recordedByName: student.recordedByName,
        classTeacherId: klass.teacherId,
        // 자리(LAB·JJ)는 표기하지 않는다 — 담당이 방이라 대신 찍은 한 사람 이름이 전 칸에 반복된다.
        seatLabel: klass.seatLabel,
      });
  // 🔴 보드가 편집 불가면(읽기 전용 역할 · 강사의 7일 편집창 밖 · 다른 강사 뷰) 어떤 칸도 못 찍는다.
  //    상단 띠는 같은 값을 읽어 스스로를 감추는데 이 칸만 안 읽어서, 서버가 거절할 버튼을 내밀고
  //    있었다([[#103]]). 진짜 차단은 여전히 서버 몫이다([[#77]]).
  const canMark = boardEditable && (klass.ownedByMe || canDeskMark(status, klass.phase));
  /**
   * 이름 글자는 **칸 폭에 비례**해 커진다(원장 2026-09-04 *"출결에도 학생 이름이 최대한 꽉 차게. 우리 스타일대로"*) —
   * 가장 좁은 칸(43px)에선 옛 사다리와 같은 13px, 창을 넓혀 칸이 135px이면 24px 상한까지. 하한(11px)에서도 넘치면
   * 종전처럼 말줄임 + 전체 이름은 이 버튼의 마우스오버(`seatHoverTitle`)에.
   */
  // 🔴 사다리(`fitSeatName`)가 아니라 **칸 폭 비례**다(원장 2026-09-04) — 고정 px 사다리는 넓은 창에서 글자가 안 커진다.
  const nameSize = fluidNameFontSize(student.studentName, { minPx: NAME_FILL_MIN_PX.seatCell, maxPx: NAME_FILL_MAX_PX });
  /** 겹판(메뉴·오류)이 붙을 자리 — 포털이라 좌표를 이 버튼에서 잰다(`CellPopover` 주석). */
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const closeMenu = useCallback(() => setOpen(false), []);

  function save(next: "present" | "late" | "absent") {
    setError(null);
    // 시각도 지금으로 미리 옮긴다 — 안 그러면 방금 찍은 칸에 **옛 시각**이 남아 있다가 몇 초 뒤 튄다.
    setOptimistic({ status: next, at: new Date().toISOString() });
    setOpen(false);
    startTransition(() => {
      setAttendanceCell({
        studentId: student.studentId,
        classId: klass.classId,
        sessionDate: date,
        status: next,
        slotStart: student.writeSlot,
        periodStart: klass.firstStart,
        quiet: true,
        source: "live",
        // 수업 나누기로 온 학생(0351a)은 서버가 나누기 표를 직접 보고 연다(`hasSplitInto`) — 플래그를 싣지 않는다(결정 #5 ②).
      })
        .then((res) => {
          if ("error" in res) {
            setOptimistic(null); // 상태·시각을 **함께** 되돌린다
            setError(res.error);
            return;
          }
          router.refresh();
        })
        .catch(() => {
          setOptimistic(null);
          setError("저장하지 못했습니다 — 다시 눌러 주세요");
        });
    });
  }

  return (
    <div className="relative h-full min-w-0">
      <button
        ref={btnRef}
        type="button"
        disabled={busy || !canMark}
        aria-haspopup={canMark ? "menu" : undefined}
        aria-expanded={canMark ? open : undefined}
        onClick={() => canMark && setOpen((v) => !v)}
        title={`${seatHoverTitle({
          studentName: student.studentName,
          schoolGrade: student.schoolGrade,
          mark,
          note: student.note,
          checkedAt: check?.full,
          recordedByName: recorder,
        })}${
          // 보강 예약(0264a) — 왜 이 칸에 섰는지(결석분)를 hover에 적는다. 찍으면 예약은 서버가 이행 처리한다.
          student.reservedMakeup
            ? ` · 보강 예약(${student.reservedMakeup.absenceDate.slice(5).replace("-", "/")} 결석분${
                student.reservedMakeup.periodLabel ? ` · ${student.reservedMakeup.periodLabel}` : ""
              })`
            : ""
        }${
          // 수업 나누기(0351a) — 왜 이 칸에 섰는지(또는 다른 반에 가 있는지)를 hover에 적는다.
          student.splitMark ? ` · ${student.splitMark.note}` : ""
        }`}
        /* 🔴 링(검색 강조·hover)은 **칸 전체**에 두른다 — 시각 줄까지가 한 칸이라, 이름 알약에만 두르면
           찾은 칸의 아래 절반이 테두리 밖으로 새어 나간 것처럼 보인다. */
        className={`flex h-full w-full flex-col items-center rounded-lg ${
          canMark ? "hover:ring-primary/40 cursor-pointer hover:ring-2" : "cursor-default"
        } ${found ? "ring-primary ring-2" : ""} disabled:opacity-60`}
      >
        {/* 이름 알약 — `@container`: 이름 글자가 이 알약의 폭(cqw)을 읽어 커진다(name-fit.ts `fluidNameFontSize`).
            시각 줄은 **이 알약 아래**(원장 시안)라 이름이 쓸 폭이 줄지 않는다. */}
        <span
          /* 🔴 수업이 끝난 뒤에 찍은 칸은 **진한 회색 테두리**(원장 2026-08-24). 안쪽 링이라 칸 크기가
             안 변한다(테두리를 주면 1px씩 커져 3열 격자가 밀린다). 색은 상태 배경을 덮지 않는 회색. */
          className={`@container flex min-h-9 w-full items-center justify-center rounded-lg px-1 py-1 ${SEAT_MARK_TONE[mark]} ${
            check?.afterClass ? "ring-2 ring-inset ring-neutral-fill" : ""
          } ${
            // 보강 예약으로 선 학생 — 기록 전엔 보라 점선(출석부 '보강 예약' 칸과 같은 문법), 찍히면 상태 색이 주인이다.
            student.reservedMakeup && !check ? "outline-1 outline-dashed -outline-offset-2 outline-purple/60" : ""
          } ${
            // 수업 나누기로 온 학생 — 기록 전엔 파란 점선(시간표 '나눔' 박스와 같은 info 색). 찍히면 상태 색이 주인이다.
            student.splitMark?.dir === "in" && !check ? "outline-1 outline-dashed -outline-offset-2 outline-blue/60" : ""
          }`}
        >
          <span className="max-w-full truncate leading-none font-bold" style={{ fontSize: nameSize }}>
            {student.studentName}
          </span>
        </span>
        {/* 체크 시각(+담임 아닌 입력자) — 기록이 없으면 **아예 안 그린다**(빈 자리가 곧 "아직 안 찍음").
            🔑 색은 **출결 상태의 잉크**를 그대로 쓴다(원장: *"검정이 아니어야되고 가독성이 좋은 색상으로"*):
               출석 #0a5537 · 지각 #7d3f00 · 결석 #971616 — 셋 다 카드 바탕에서 대비가 넉넉하고,
               상태마다 색이 달라 시각만 훑어도 무슨 표시인지 읽힌다. 흐리게(opacity) 깔지 않는다 —
               10px에서 투명도를 주면 결석 빨강이 가장 먼저 안 읽힌다.
            🔑 한 줄로 두되 좁으면 자연스레 접히게(`flex-wrap`) — 좁은 칸에 `8/28 13:24 (박소선)`은 한 줄로
               못 들어간다. 잘라서 감추는 것보다 접어서 다 보이는 게 낫다. */}
        {check && (
          <span
            className={`num mt-0.5 flex w-full flex-wrap items-baseline justify-center gap-x-1 text-center text-xs leading-tight font-bold ${SEAT_MARK_INK[mark]}`}
          >
            {check.date && <span>{check.date}</span>}
            <span>{check.time}</span>
            {recorder && <span className="max-w-full truncate">({recorder})</span>}
          </span>
        )}
      </button>
      {/* 🔴 메뉴·오류는 카드 밖(포털)에 뜬다 — 카드 `overflow-hidden`에 잘리던 자리(`CellPopover` 주석).
          테두리를 두른다: 카드 밖 화면 어디에도 뜰 수 있어 배경만으로는 경계가 안 읽힌다. */}
      {open && canMark && (
        <CellPopover anchorRef={btnRef} onClose={closeMenu}>
          <div className="border-line bg-card shadow-modal flex gap-0.5 rounded-lg border p-1">
            {MARKS.map((m, i) => (
              <button
                key={m.status}
                type="button"
                /* 겹판이 DOM 끝(포털)으로 나가 Tab 순서에서 칸 바로 뒤가 아니게 됐다 — 열릴 때 첫 항목에
                   초점을 줘 키보드로도 그대로 고를 수 있게 한다(Esc로 닫힌다). */
                autoFocus={i === 0}
                onClick={() => save(m.status)}
                className={`rounded-md px-2 py-1 text-xs font-bold whitespace-nowrap ${SEAT_MARK_TONE[m.status]}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </CellPopover>
      )}
      {/* 메뉴가 열려 있는 동안엔 안 그린다 — 둘 다 같은 자리(칸 아래)에 떠서 서로를 덮는다.
          닫으면 다시 보이므로 실패 사실은 사라지지 않는다(다음 저장 시도에서 지워진다). */}
      {error && !open && (
        <CellPopover anchorRef={btnRef}>
          <p className="border-danger bg-card text-danger shadow-modal w-40 rounded-lg border px-2 py-1 text-xs font-bold">
            {error}
          </p>
        </CellPopover>
      )}
    </div>
  );
}
