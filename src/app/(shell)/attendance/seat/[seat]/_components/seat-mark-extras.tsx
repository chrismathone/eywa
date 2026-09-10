"use client";

import type { ReactNode, RefObject } from "react";
import { Popover } from "@base-ui/react/popover";
import { NoteForm } from "@/features/onescreen/components/attendance-pills";
import { SEAT_LABEL } from "./seat-status";
import { seatNoteTitle } from "@/features/attendance/seat/note-title";
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
  onMark,
}: {
  cur: SeatStatus | null;
  studentName: string;
  disabled: boolean;
  /** 고른 값. **이미 그 값이면 호출부가 미체크로 되돌린다**(같은 값이 그대로 넘어온다). */
  onMark: (next: SeatStatus) => void;
}) {
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
export function SeatMemoMark({ note, status }: { note: string | null; status: SeatStatus | null }) {
  if (!note || !note.trim()) return null;
  return (
    <span
      aria-hidden
      title={seatNoteTitle(status, note) ?? note}
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

/**
 * **지난 결석 사유** 한 줄 — 원장 2026-09-08 *"JJ와 LAB 수업의 경우 이전수업이 결석인 경우에 사유를
 * 확인할 수 있도록"*.
 *
 * 🔴 오늘 칸이 이미 찍혔으면 안 보여 준다 — 오늘 사유 칸 바로 옆에 지난 사유가 나란히 서면 어느 것이
 *    오늘 것인지 헷갈린다(그게 지금 고치고 있는 종류의 버그다).
 * ⚠️ 사유가 없으면 날짜만 적는다 — "결석했는데 사유는 안 적혀 있다"도 알아야 할 사실이다.
 */
export function PrevAbsenceHint({
  prev,
  cur,
}: {
  prev: { date: string; note: string | null } | null | undefined;
  cur: SeatStatus | null;
}) {
  if (!prev || cur !== null) return null;
  const md = monthDay(prev.date);
  return (
    <p
      className="text-att-absent-ink/80 truncate text-xs"
      title={`지난 수업(${prev.date}) 결석${prev.note ? ` · ${prev.note}` : " — 사유 미기재"}`}
    >
      지난 결석 {md}
      {prev.note ? ` · ${prev.note}` : ""}
    </p>
  );
}

/**
 * 같은 날 교시 사이 신호 **한 묶음** — 표 두 벌이 그대로 물려 받는다(props를 셋으로 늘리지 않는다).
 * 🔴 `nextStartByStudent`는 **로그인 화면에서만** 채워진다(비로그인 PIN엔 새 정보를 안 내려보낸다).
 */
export type SeatPeriodHintData = {
  /** `classId|studentId` → 앞 교시 시각("HH:MM"). 상태로 안 걸러진 채 온다. */
  prevAbsentByCell?: Readonly<Record<string, string>>;
  /** 학생 id → **오늘 남은 다음 수업** 시작시각("HH:MM"). 이 자리만이 아니라 오늘 전 과목을 본다. */
  nextStartByStudent?: Readonly<Record<string, string>>;
  /**
   * 학생 id → 그 다음 수업의 **강의실 이름**(등록된 정본). 모르면 키가 없다.
   * 🔴 방을 모르면 **시각만** 적는다 — 지어내지 않는다([[#115]]: 라벨이 번호만일 때 정본으로 정규화).
   */
  nextRoomByStudent?: Readonly<Record<string, string>>;
  /** 툴팁에 적을 자리 이름(랩실·JJ실) — raw 키(`jj`)를 화면에 내보내지 않는다. */
  seatName: string;
};

/**
 * **같은 날 교시 사이 신호** 한 줄 — 랩실·JJ실이 쓰는 한 벌(원장 2026-09-10:
 * *"이 학생이 이전수업에 결석이였으면 …"* · *"이후에 수업이 남아있으면 다음 수업이 있다고 표시해줘"*).
 *
 * 🔴 **표시만 한다** — 이 줄이 무엇을 자동으로 찍지 않는다. 결석은 사람이 버튼을 누를 때만 찍힌다.
 * 🔴 앞 교시 결석은 **아직 안 찍힌 칸에만** 적는다 — 이미 찍힌 칸 옆에 서면 어느 것이 이 교시의
 *    사실인지 헷갈린다(지난 결석 줄과 같은 규약).
 * ⚠️ 임계값 이름("직전"·"방금") 대신 **실제 교시 시각**을 적는다([[#121]]) — 당번이 그 칩을 눌러
 *    눈으로 대조할 수 있어야 한다.
 * ⚠️ '다음'은 **이 자리 교시만** 본다. 그래서 아무것도 안 적힌 줄은 "오늘 수업이 더 없다"가 아니라
 *    "이 방에는 더 안 온다"이고, 그 사실을 툴팁이 밝힌다.
 *
 * 🔴 **한 줄에 이어 붙이지 말 것 · `truncate` 금지.** 이 줄이 들어가는 JJ 표 출결 칸은 콘텐츠 폭이
 *    **≈80px**다(열 최소 440px × 20%, 그 20%는 「결석 사유」 4글자가 겨우 들어가게 잡은 수치다).
 *    둘을 `·`로 잇고 자르면 뒤쪽 '다음 17:20'이 **어떤 창 폭에서도 화면에 안 나온다**(적대 리뷰 2026-09-10).
 *    그래서 **각자 제 줄**에서 어절 단위로 접힌다(`break-keep`) — 줄이 늘어도 안 보이는 것보단 낫다.
 */
export function SeatPeriodHints({
  prevAbsentStart,
  nextStart,
  nextRoom,
  seatName,
  cur,
}: {
  /** 그 학생의 바로 앞 교시가 결석이면 그 교시 시각("HH:MM"), 아니면 null. */
  prevAbsentStart: string | null | undefined;
  /** 오늘 남은 다음 수업 시작시각("HH:MM"), 없으면 null. */
  nextStart: string | null | undefined;
  /** 그 다음 수업의 강의실 이름 — 모르면 시각만 적는다(지어내지 않는다). */
  nextRoom?: string | null;
  seatName: string;
  cur: SeatStatus | null;
}) {
  const showPrev = !!prevAbsentStart && cur === null;
  if (!showPrev && !nextStart) return null;
  return (
    <>
      {showPrev ? (
        <p
          className="text-att-absent-ink/80 text-xs leading-tight font-semibold break-keep"
          title={`오늘 ${seatName} ${prevAbsentStart} 교시에 결석으로 찍혀 있습니다`}
        >
          앞 교시({prevAbsentStart}) 결석
        </p>
      ) : null}
      {nextStart ? (
        <p
          className="text-text-dim text-xs leading-tight font-semibold break-keep"
          title={
            nextRoom
              ? `${seatName} 수업이 끝나면 오늘 ${nextStart} ${nextRoom} 수업이 있습니다`
              : `${seatName} 수업이 끝나면 오늘 ${nextStart} 수업이 있습니다 — 강의실이 시간표에 없습니다`
          }
        >
          {/* 🔴 '다음 17:20'은 무엇을 하라는 말인지 안 읽힌다(원장 2026-09-10) — **시각 + 어디로**를 적는다.
              방을 모르면 시각만(지어낸 방 이름은 아이를 엉뚱한 데로 보낸다). */}
          {nextStart} {nextRoom ? `${nextRoom} 이동` : "다음 수업"}
        </p>
      ) : null}
    </>
  );
}

/** "2026-09-04" → "9/4". 이미 KST 날짜 문자열이라 파싱하지 않는다(타임존 되밀림 금지). */
function monthDay(iso: string): string {
  const [, m, d] = iso.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : iso;
}
