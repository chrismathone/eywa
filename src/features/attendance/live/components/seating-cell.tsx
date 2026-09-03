"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useSeatingCanEdit } from "./seating-edit-context";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import { fitSeatName, SEAT_CELL_NAME_LADDER } from "@/features/attendance/seat/name-fit";
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
   * 칸은 3열 격자라 폭이 고정이다 — 접미사 붙은 이름(`김하늘A`)이 넘쳐 `김하...`로 잘렸다.
   * 칸을 넓히지 않고 **그 이름만** 한 단계씩 줄인다(하한 11px). 하한에서도 넘치면 말줄임이
   * 남지만, 전체 이름은 이 버튼의 마우스오버(`seatHoverTitle`)에 늘 들어 있다.
   */
  const fit = fitSeatName(student.studentName, SEAT_CELL_NAME_LADDER);

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
        type="button"
        disabled={busy || !canMark}
        onClick={() => canMark && setOpen((v) => !v)}
        title={seatHoverTitle({
          studentName: student.studentName,
          schoolGrade: student.schoolGrade,
          mark,
          note: student.note,
          checkedAt: check?.full,
          recordedByName: recorder,
        })}
        /* 🔴 링(검색 강조·hover)은 **칸 전체**에 두른다 — 시각 줄까지가 한 칸이라, 이름 알약에만 두르면
           찾은 칸의 아래 절반이 테두리 밖으로 새어 나간 것처럼 보인다. */
        className={`flex h-full w-full flex-col items-center rounded-lg ${
          canMark ? "hover:ring-primary/40 cursor-pointer hover:ring-2" : "cursor-default"
        } ${found ? "ring-primary ring-2" : ""} disabled:opacity-60`}
      >
        {/* 이름 알약 — 색·크기는 종전 그대로다. 시각 줄은 **이 알약 아래**(원장 시안)라 이름이 쓸 폭이
            줄지 않는다 → `fitSeatName` 사다리는 손대지 않는다(08-19 잘림 수정 회귀 금지). */}
        <span
          /* 🔴 수업이 끝난 뒤에 찍은 칸은 **진한 회색 테두리**(원장 2026-08-24). 안쪽 링이라 칸 크기가
             안 변한다(테두리를 주면 1px씩 커져 3열 격자가 밀린다). 색은 상태 배경을 덮지 않는 회색. */
          className={`flex min-h-9 w-full items-center justify-center rounded-lg px-1 py-1 ${SEAT_MARK_TONE[mark]} ${
            check?.afterClass ? "ring-2 ring-inset ring-text-faint" : ""
          }`}
        >
          <span className={`truncate leading-tight font-bold ${fit.className}`}>
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
            className={`num mt-0.5 flex w-full flex-wrap items-baseline justify-center gap-x-1 text-center text-[10px] leading-tight font-bold ${SEAT_MARK_INK[mark]}`}
          >
            {check.date && <span>{check.date}</span>}
            <span>{check.time}</span>
            {recorder && <span className="max-w-full truncate">({recorder})</span>}
          </span>
        )}
      </button>
      {open && canMark && (
        <div className="bg-card shadow-card absolute top-full left-0 z-30 mt-1 flex gap-0.5 rounded-lg p-1">
          {MARKS.map((m) => (
            <button
              key={m.status}
              type="button"
              onClick={() => save(m.status)}
              className={`rounded-md px-2 py-1 text-[11px] font-bold whitespace-nowrap ${SEAT_MARK_TONE[m.status]}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="text-danger absolute top-full left-0 z-20 mt-1 w-40 text-[10px]">{error}</p>
      )}
    </div>
  );
}
