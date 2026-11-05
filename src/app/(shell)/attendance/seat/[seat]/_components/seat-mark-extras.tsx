"use client";

import type { ReactNode, RefObject } from "react";
import { Popover } from "@base-ui/react/popover";
import { NoteForm } from "@/features/onescreen/components/attendance-pills";
import { SEAT_LABEL } from "./seat-status";
import { SEAT_NOTE_MAXLEN } from "@/features/attendance/seat/seat";
import type { SeatStatus } from "@/features/attendance/seat/server/actions";

/**
 * 자리 출석부(랩실·JJ실)의 **결·지 버튼 + 사유 칸** — 두 화면이 쓰는 한 벌.
 *
 * 원장 2026-09-08: *"jj실 출석부도 결석 누르면 사유 입력할 수 있게. 지각도 만들어주고. 다른 출결과
 * 동일하게"* → *"지각 및 사유는 JJ/LAB 둘다 동일"*.
 *
 * 🔴 **두 화면이 이 한 파일을 쓴다** — 랩실·JJ실에 각자 버튼을 그리면 한쪽만 고쳐진다(그 갈림이
 *    바로 오늘 고친 `seatMarkOf` 사고였다).
 * ⚠️ 저장 상태 3종(출석·결석·지각)은 **자리판의 계약 그대로**다 — 조퇴·공결·보강은 출석부 전용이라
 *    여기서 만들지 않는다(`setSeatCell`이 그 값을 거절한다).
 * 🔑 교시 사이 신호 줄(앞 교시 결석·다음 행선지·마지막 수업)은 `seat-period-hints.tsx`에 있다(표시 전용이라 떼어 냈다).
 */

/**
 * 출결 **세 버튼**(출석 / 결석 / 지각) — 원장 2026-09-10: *"출결 버튼을 `출석 / 결석 / 지각` 세 개,
 * 같은 크기로"* · *"상태가 바뀌어도 버튼 수·폭이 변하지 않아야"*.
 *
 * 🔴 **언제나 세 개, 언제나 같은 폭**(`grid-cols-3`) — 종전엔 `출석`(넓음) + `결`·`지`(좁음)였고 그나마
 *    이미 그 상태면 버튼이 사라져서, 찍을 때마다 칸 폭과 줄 높이가 출렁였다(지각이면 두 개만 남았다).
 *    선택된 것만 **채워진다**(`ATT_SOLID`) — 개수·폭은 상태와 무관하다.
 * 🔑 **고른 것을 다시 누르면 미체크로 되돌아간다** — 되돌릴 문을 잠그면 오클릭한 결석에서 못 빠져나온다
 *    ([[#103]]). 그래서 `onMark`는 같은 값을 다시 받으면 호출부가 `null`로 저장한다.
 * 🔴 랩실 카드·JJ실 표가 **이 한 벌**을 쓴다 — 두 화면에 각자 버튼을 그리면 한쪽만 고쳐진다.
 * ⚠️ 저장 상태 3종은 자리판의 계약 그대로다(조퇴·공결·보강은 출석부 전용 — `setSeatCell`이 거절한다).
 */
export function SeatMarkTriad({
  cur,
  studentName,
  disabled,
  statusOnly = false,
  onMark,
}: {
  cur: SeatStatus | null;
  studentName: string;
  disabled: boolean;
  /**
   * 🔴 자리 출석부 **읽기 권한**(원장 2026-11-05) — 세 단추는 상태 표시를 겸하므로, 잠긴 단추를 남기지 않고
   *    **상태 글자 한 칸**만 그린다(write-lock.ts 규칙 1). 칸 폭은 세 단추와 같은 전폭이라 줄이 출렁이지 않는다.
   *    지난 날짜 잠금(`disabled`)은 종전대로 잠긴 세 단추다 — 그건 권한이 아니라 날짜 규칙이다.
   */
  statusOnly?: boolean;
  /** 고른 값. **이미 그 값이면 호출부가 미체크로 되돌린다**(같은 값이 그대로 넘어온다). */
  onMark: (next: SeatStatus) => void;
}) {
  if (statusOnly) {
    const label = cur ? SEAT_LABEL[cur] : "미체크";
    return (
      <div
        aria-label={`${studentName} ${label}`}
        className={`w-full rounded-md border px-0.5 py-1 text-center text-xs font-bold ${
          cur ? `${SEAT_MARK_ON[cur]} border-transparent` : "border-line bg-card text-text-dim"
        }`}
      >
        {label}
      </div>
    );
  }
  return (
    <div className="grid w-full grid-cols-3 gap-0.5">
      {SEAT_MARK_ORDER.map((k) => {
        const on = cur === k;
        return (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => onMark(k)}
            aria-pressed={on}
            aria-label={`${studentName} ${SEAT_LABEL[k]}`}
            title={on ? `${SEAT_LABEL[k]} — 다시 누르면 미체크로 되돌립니다` : SEAT_LABEL[k]}
            className={`min-w-0 rounded-md border px-0.5 py-1 text-center text-xs font-bold disabled:cursor-default disabled:opacity-50 ${
              on ? `${SEAT_MARK_ON[k]} border-transparent` : "border-line bg-card text-text-dim"
            }`}
          >
            {SEAT_LABEL[k]}
          </button>
        );
      })}
    </div>
  );
}

/** 버튼 순서 — 화면 셋(랩실·JJ실)이 같은 순서로 서야 손이 기억한다. */
const SEAT_MARK_ORDER: readonly SeatStatus[] = ["present", "absent", "late"];
/** 눌린 버튼 채움 — 출결 의미색 단일 소스(`ATT_SOLID`)와 같은 값. */
const SEAT_MARK_ON: Record<SeatStatus, string> = {
  present: "bg-green text-white",
  absent: "bg-danger text-white",
  late: "bg-amber text-white",
};

/**
 * 메모 표식 — **모서리 삼각형**(원장 2026-09-10 *"메모가 생기면 메모있음 표시해는 삼각형 있잖아
 * 스프레드시트처럼"*). 사유든 특이사항이든 **한 글자라도 있으면** 뜬다.
 *
 * 🔴 **의미색이 아니다** — 출결 상태색(초록·앰버·빨강)과 같은 자리에서 다투면 안 되므로 무채색
 *    (`--neutral-fill`)이다. 뜻은 "적힌 게 있다" 하나뿐이고 상태는 버튼이 말한다.
 * ⚠️ `pointer-events-none` — 카드 클릭·드래그를 가로채지 않는다(툴팁은 부모 칸이 이미 갖고 있다).
 */
// 🔴 상태는 안 받는다 — 표식의 뜻은 "적힌 게 있다" 하나뿐이고, 사유 문장(상태에 따라 라벨이 갈리는 그것)은
//    이제 **부모 칸의 카드**가 띄운다(원장 2026-09-15). 여기서 다시 문장을 만들면 두 곳이 갈린다.
export function SeatMemoMark({ note }: { note: string | null }) {
  if (!note || !note.trim()) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute top-0 right-0 h-0 w-0 border-t-[10px] border-l-[10px] border-t-[var(--neutral-fill)] border-l-transparent"
    />
  );
}

/**
 * 사유·특이사항 **입력 팝업** — 원장 2026-09-10: *"결석이나 지각 이면 지금처럼 아래쪽에 사유 쓰는게
 * 아니라 '입력 팝업'이 뜨고 거기 입력하는걸로"* + *"우클릭해서 특이사항 입력할 수 있도록"*.
 *
 * 🔴 **사유 없이도 저장된다** — 상태는 팝업이 뜨기 **전에 이미** 저장돼 있고 이 창은 그 위에 얹히는
 *    후속일 뿐이다(ECS `AttendanceCheck`와 같은 계약). 급하면 Esc·바깥 클릭으로 넘긴다.
 * 🔴 **비로그인 공개 화면에선 열지 않는다** — 그 경로는 사유를 조회조차 안 한다(병원·수술·가족 일정이
 *    적힌다). 호출부가 `showReason=false`면 이 컴포넌트를 아예 안 그린다.
 * 🔑 입력하는 동안 **자동 저장**(원장 *"실시간 저장도"*) — `onDraft`가 호출부의 디바운스 저장으로 간다.
 *    영구(학생 프로필) 저장이 아니라 **그날 그 교시 기록**(`attendance_records.note`)이다.
 * ⚠️ 폼은 수학(원스크린)·영어 시트와 **같은 것**(`NoteForm`) — 두 화면이 다른 낱말을 쓰면 같은 기능인지 모른다.
 */
export function SeatNotePopover({
  open,
  onOpenChange,
  anchorRef,
  note,
  status,
  studentName,
  onSave,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement | null>;
  note: string | null;
  status: SeatStatus | null;
  studentName: string;
  onSave: (next: string) => void;
  children: ReactNode;
}) {
  const label = status ? `${SEAT_LABEL[status]} 사유` : "특이사항";
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      {children}
      <Popover.Portal>
        <Popover.Positioner anchor={anchorRef} side="bottom" align="start" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card w-[240px] rounded-lg border p-2 outline-none">
            {/* 🔴 **`key`를 note에 걸지 말 것** — 여기는 글자마다 자동 저장이라 `note`가 입력 중에 계속
                바뀐다. ECS처럼 key를 걸면 한 글자 칠 때마다 폼이 다시 마운트돼 커서가 날아간다.
                열 때 서버 값으로 시작하는 성질은 **팝업이 닫히면 언마운트**되는 것으로 이미 성립한다. */}
            <NoteForm
              initial={note ?? ""}
              label={`${studentName} · ${label}`}
              // 서버(`setSeatCell`)가 같은 상한으로 거절한다 — 입력칸에서 먼저 멈춰야 '저장된 척'이 안 생긴다.
              maxLength={SEAT_NOTE_MAXLEN}
              onDraft={onSave}
              onCancel={() => onOpenChange(false)}
              onSave={(text) => {
                onSave(text);
                onOpenChange(false);
              }}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
