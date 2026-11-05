"use client";

import { isDirectEditClick } from "@/lib/direct-edit";
import { tipProps } from "@/components/hover-tip/tip";
import { monthDayLabel } from "@/lib/date-kst";

import { useEffect, useRef, useState } from "react";
import type { AttendanceStatus } from "@/features/attendance/server/queries";
import {
  CELL_SCROLL_MARGIN,
  cellDisplay,
  ghostCellKind,
  ghostSlotLines,
  rollupDay,
  sharedOtherSlots,
  slotBreakdown,
  type AttendanceMark,
  type SlotMark,
} from "@/features/attendance/cell-display";
import { NOT_MINE_MESSAGE, statusTextOf } from "@/features/attendance/cell-display";
import { cellKey, rowKey } from "@/features/attendance/grid/model";
import type { GridValue, LocalPaint } from "@/features/attendance/grid/store";
import { revertTarget, type Paint } from "@/features/attendance/grid/paint-chain";
import { isRecordless } from "@/features/attendance/grid/optimistic-value";
import type { MatrixReservation } from "@/features/attendance/server/queries";
import {
  RESERVED_CELL_CHARS,
  RESERVED_CELL_CLASS,
  reservationDetail,
} from "@/features/attendance/makeup-reservation";
import { useCellState } from "./grid-context";
import { scopeFieldsFor, useAttendanceScope } from "./scope-context";
import { CellPopover, type PopoverAnchor } from "./cell-popover";
import { MakeupReserveDialog } from "./makeup-reserve-dialog";
import { GhostTransferPopover } from "./ghost-popover";
import { RangeStatusPopover } from "./range-status-popover";
// 화면 언어 — 상태 표기는 `statusTextOf`(한글 맵 옆)가 단일 소스, 나머지 문구는 사전.
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/** 카드 한 줄 안에서 줄을 나눈다(교시별 기록) — 카드가 `whitespace-pre-line`으로 살려 그린다. */
const NEWLINE = "\n";

/** 메모의 낙관 쓰기 표식 — 값과 따로 쥔다(아래 noteOwner). */
type NotePaint = Paint<string | null>;
/**
 * 팝오버에 돌려주는 표식 — 값(격자 저장소)과 메모를 함께 싣는다. 메모를 안 보낸 저장이면 `note`는 null.
 * `shown` = 이 쓰기가 칠한 값 — 성공 보정이 서버 시수를 안 받았으면 **칠한 그 값**을 결과로 남긴다(보정 때 다시
 * 만들면 칸의 지금 값이 달라져 자동 시수·교시 합 판정이 어긋난다).
 */
type CellPaint = { value: LocalPaint | null; note: NotePaint | null; shown?: GridValue };
/** 칸의 메모 덮개 — 고친 메모(`text` null = 서버 값 사용)와 그 메모를 칠한 쓰기. */
type Memo = { text: string | null; owner: NotePaint | null };
const NO_MEMO: Memo = { text: null, owner: null };

/**
 * 출석부 시트의 한 칸.
 *
 * 조작은 시트와 같다: 클릭=선택 · 숫자 타이핑=입력(0 결석 / 1·1.5·2 출석+시수) · 방향키·Tab·Enter 이동 ·
 * Shift로 범위 · Ctrl+C/V · Ctrl+Z · 우하단 손잡이 드래그=채우기 · Delete=지우기.
 * 숫자로 표현할 수 없는 것(지각·조퇴·보강·메모)만 **우클릭(=더블클릭) 팝오버**가 맡는다.
 * 7일이 지나 잠긴 칸에서도 팝오버는 열린다 — 상태·시수는 잠기고 **메모만** 고칠 수 있다.
 *
 * ⚠️ 표기(숫자·배경색)는 `cell-display.ts` 단일 소스를 그대로 쓴다 — 격자에서 다시 그리지 않는다.
 * ⚠️ 이 칸은 **자기 상태만 구독**한다(`useCellState`). 옆 칸이 바뀌어도 다시 그리지 않는다 — 표가
 *    수천 칸이라 전역 구독으로 만들면 방향키가 밀린다.
 */
export function AttendanceCell({
  studentId,
  classId,
  sessionDate,
  initialStatus,
  note,
  initialUnits,
  attendDay,
  muted,
  holiday,
  outside,
  derived,
  lockedReason,
  daySlots,
  otherSlots,
  sharedDay,
  reservation = null,
  studentName,
  className,
}: {
  studentId: string;
  classId: string;
  sessionDate: string;
  /**
   * 이 칸에 걸린 **보강 예약**(0264a) — 값이 없는 칸에 '보강 예약' 네 글자(2×2)로 선다. 값이 찍히면(예약 이행) 서버가
   * 예약을 `done`으로 넘겨 다음 렌더엔 오지 않는다. 팝오버는 예약 정보와 '예약 취소'를 보여 준다.
   */
  reservation?: MatrixReservation | null;
  /** 예약 창 머리에 적을 이름·반 — 행(MatrixRow)이 넘긴다. 없으면 id 없이 날짜만 적는다. */
  studentName?: string;
  className?: string;
  initialStatus: AttendanceStatus | null;
  note?: string | null;
  initialUnits?: number | null;
  /** 그 학생이 그 요일에 등원하는지 — 기록 없는 칸의 하이라이트. */
  attendDay?: boolean;
  /** 주말·공휴일 등 수업이 없는 날(회색). */
  muted?: boolean;
  /** 학원 휴일(휴강) — 주말 회색과 갈라 칠한다(2026-09-07). `muted`와 함께 온다. */
  holiday?: boolean;
  /**
   * 그 날 이 반 소속이 아니었다(입원 전·퇴원 후) — 진한 회색.
   * ⚠️ **입력을 막지 않는다** — 퇴원 뒤 보강 출석이 실제로 있고, 막으면 이미 들어온 기록을 고칠 길이 사라진다.
   */
  outside?: boolean;
  /** 수기 기록이 아니라 수업보고서에서 파생한 값 — 툴팁에 출처 표시. */
  derived?: boolean;
  /**
   * 이 칸을 왜 못 고치는가 — `"past"`(수정 기간 7일 경과) · `"notMine"`(이 표의 몫이 아닌 빗금 칸) · `"seatOnly"`(자리 기록뿐) ·
   * ⚠️ 날짜(강사가 수업하지 않는 날)로는 막지 않는다 — 보강이 있어 모든 날이 열려 있다(원장 2026-09-17 저녁).
   * 🔴 **문장이 아니라 사유 코드**다. 문장(157B)을 서버가 칸마다 만들어 내려보내면 잠긴 칸 수천 개가
   *    그대로 RSC 페이로드 곱이 된다(강사 전체 보기 실측 1MB대) — 표시는 클라에서 편다.
   */
  lockedReason?: "past" | "notMine" | "seatOnly" | null;
  /**
   * 그날 교시가 **둘 이상**일 때만 오는 교시별 기록(0196a) — 숫자(합)·줄무늬·툴팁의 근거.
   * 대부분의 칸은 undefined라 종전과 완전히 같이 그려진다.
   */
  daySlots?: SlotMark[];
  /**
   * **이 표가 세지 않는 교시**(강사 전체 보기의 남의 교시·자리 JJ·LAB) — 값이 아니라 표시 근거다.
   * 값이 비어 있을 때만 빗금으로 드러난다: 빈칸으로 두면 사람이 그 위에 다시 찍어 남의 기록을
   * 덮는다(#103). 반별 보기에선 항상 undefined라 종전과 완전히 같이 그려진다.
   *
   * 🔴 **값이 하나도 없는 칸(빗금)은 이 화면에서 입력을 안 받는다**(`locked`로 사유를 알린다).
   *    권한이 아니라 **안전장치**다: 월간 격자의 저장은 교시를 모른 채 그날 **모든 교시**에 가므로
   *    (save-targets ①) 여기서 받으면 남의 기록·자리(JJ)를 화면에 흔적도 없이 덮거나 지운다. 게다가
   *    낙관값은 서버 값과 같아질 때만 벗겨지는데 서버는 이 칸을 영원히 비워 두므로 친 숫자가
   *    새로고침 전까지 시수·출석률에 남는다. 고칠 길은 막지 않는다 — **반별 보기에선 그대로 열려 있다**.
   * ⚠️ 값이 **있는** 칸(내 교시 + 남의 교시)은 잠그지 않는다. 대신 툴팁이 다른 선생님 교시는 "함께 바뀐다",
   *    자리(JJ·랩실, `seat`)는 "그대로"라고 말한다 — 강사 보기 저장은 자리 행을 안 건드린다(원장 2026-09-12).
   */
  otherSlots?: SlotMark[];
  /**
   * 이 칸의 값에 **교시를 안 남긴 기록**이 섞였다(강사 전체 보기 전용, queries `dayAxis`).
   * 그런 기록은 담당을 가릴 수 없어 좁히지 않으므로 **그 반 담당 전원 화면에 같은 값**으로 잡힌다 —
   * 툴바 칩("칸 = 이 선생님 교시")의 유일한 예외라, 그 사실을 이 칸이 직접 말한다.
   */
  sharedDay?: boolean;
}) {
  const row = rowKey(classId, studentId);
  const key = cellKey(row, sessionDate);
  const { state, ctx } = useCellState(key);
  // 팝오버가 고친 메모(`text` null = 아직 안 고침 → 서버 값 사용)와 그 메모를 칠한 쓰기(`owner`). effect로 state를 되쓰지 않는다(#25).
  // 메모의 낙관 쓰기 표식은 값(격자 저장소)과 **따로** 쥔다 — 격자 타이핑·서버 따라잡기는 값만 가져가고 메모는 안 건드려서, 값의
  // 표식에 묶으면 메모만 고친 저장이 실패해도 메모가 안 돌아왔다. 둘을 한 state로 묶는 건 따라잡기가 **함께** 비우게 하려고다
  // (주인만 남으면 그 저장이 나중에 실패할 때 서버와 다른 메모를 되살렸다 — 재리뷰 2026-09-11).
  const [memo, setMemo] = useState<Memo>(NO_MEMO);
  const noteEdit = memo.text;
  // 칠하기 직전 자리 = 이 렌더의 덮개(누르는 순간 부르므로 최신이다 — 늦게 오는 응답은 이 함수를 안 부른다).
  const paintNote = (v: string): NotePaint => {
    const p: NotePaint = { had: true, prev: memo.text, prevOwner: memo.owner };
    setMemo({ text: v, owner: p });
    return p;
  };
  // 저장 실패 — 그 사이 다른 저장이 메모를 가져갔으면 결과만 남긴다(그 저장이 실패하면 이 결과를 따라 거슬러 간다). 칸이 아직 이
  // 쓰기의 것이면 사슬을 거슬러 가되, **이미 끝난 앞 쓰기**에 닿으면 덮개를 벗겨 서버 값을 보인다(끝난 뒤 서버가 또 바뀌었을 수
  // 있다 — 기록해 둔 값보다 서버가 진실이다). 늦게 오는 응답이라 함수형 갱신으로 **지금** 상태를 본다.
  const revertNote = (p: NotePaint) =>
    setMemo((cur) => {
      if (cur.owner !== p) {
        p.fate = { revert: true };
        return cur;
      }
      const t = revertTarget(p);
      return t.drop || t.owner === null ? NO_MEMO : { text: t.value, owner: t.owner };
    });
  // 🔴 서버가 내 메모를 따라잡으면 덮개와 주인을 함께 벗긴다 — 값 덮개(store.setSource)와 같은 규약. 안 벗기면 격자로 행을 지운
  //    뒤에도 옛 메모 덮개가 서버 값(빈 메모)을 이겨 되살아난다(재리뷰 2026-09-11). 서버 메모가 **바뀐 렌더에서만** 본다(렌더 중
  //    조정 — effect로 state를 되쓰지 않는다, #25): 새 값이 덮개와 같으면(따라잡음) 벗기고, 직전 값이 덮개와 같았는데 서버가 다른
  //    값으로 옮겨 갔으면 **그 쓰기가 끝났을 때만** 벗긴다(응답 대기 중인 최신 메모를 옛 값으로 바꾸지 않게).
  const [seenNote, setSeenNote] = useState(note);
  if (note !== seenNote) {
    setSeenNote(note);
    const settled = memo.owner === null || memo.owner.fate !== undefined;
    if (memo.text !== null && (memo.text === (note ?? "") || (settled && memo.text === (seenNote ?? "")))) setMemo(NO_MEMO);
  }
  const [popover, setPopover] = useState<PopoverAnchor | null>(null);
  const [rangeKeys, setRangeKeys] = useState<Set<string> | null>(null);
  // 보강 예약 창 — 팝오버가 닫히면서 여니 상태는 칸이 쥔다(팝오버는 닫히면 언마운트된다).
  const [reserveOpen, setReserveOpen] = useState(false);
  const scope = useAttendanceScope();
  const ref = useRef<HTMLDivElement>(null);
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  // 잠금 사유 문장은 여기서 편다 — 판정은 grid-context·`notMineCell` 한 곳, 문장은 사전.
  // 자리뿐인 칸은 사유가 다르다 — "반별 보기에서 고치세요"는 자리 기록엔 거짓 안내다(원장 2026-09-12).
  // 🔴 읽기 권한(격자 `readOnly`)이 먼저다 — 날짜·칸 성격과 무관하게 전부 잠기고, 사유도 권한이다(원장 2026-11-05).
  const readOnly = ctx?.readOnly ?? false;
  const locked = readOnly
    ? (ctx?.lockNoteOf(sessionDate) ?? null)
    : lockedReason === "past"
      ? (ctx?.lockNoteOf(sessionDate) ?? null)
      : lockedReason === "seatOnly"
        ? t("att.lock.seatOnly")
        : lockedReason === "notMine"
            ? NOT_MINE_MESSAGE
            : null;
  // 격자에 키보드로 들어올 수 있는 **단 하나의 탭 정거장**(첫 칸). 그 뒤로는 방향키가 받는다 —
  // 칸마다 탭 정거장을 두면 31×N번을 눌러야 표를 지나칠 수 있다.
  const isFirst = ctx?.store.rows[0] === row && ctx?.store.cols[0] === sessionDate;

  // 값은 격자(낙관적 반영)가 진실 — 격자가 없으면 서버가 그린 초기값.
  // 🔴 빗금 칸의 표시 값(`g` — 다른 선생님 교시 기록, 원장 2026-09-14)은 **이 칸의 값이 아니다** — 상태·시수·메모 판정은
  //    제 몫 값만 본다. 표시만 `ghostValue`로 빗금 위에 흐리게 얹는다(합계는 격자가 이미 뺀다).
  const own = state.value?.g ? null : state.value;
  const ghostValue = state.value?.g ? state.value : null;
  const status = (ctx ? ((own?.s ?? null) as AttendanceStatus | null) : initialStatus) ?? null;
  const units = ctx ? own?.u ?? null : initialUnits ?? null;
  const editing = state.active && state.buffer !== null;

  // 활성 칸이 화면 밖이면 따라 스크롤(가로 31칸이라 방향키 이동에 필수) + 포커스도 함께 옮긴다
  // (키보드만 쓰는 사용자가 격자 안에서 길을 잃지 않게).
  useEffect(() => {
    if (!state.active) return;
    ref.current?.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [state.active]);

  // 기록이 지워진 칸엔 메모도 없다(행 자체가 삭제된다) — 접힌 모서리가 남으면 화면이 거짓말을 한다.
  // 파생이라 effect가 필요 없다.
  const noteVal = ctx && own === null ? "" : noteEdit ?? note ?? "";

  // 하루에 교시가 둘 이상인 칸 — 합계·줄무늬는 **서버가 준 값 그대로일 때만** 사실이다.
  // 값을 고치는 순간(status·시수가 초기값과 달라짐) 접었던 근거가 무너지므로 평범한 한 칸으로 돌아간다.
  // ⚠️ 파생 뱃지(fromReport)가 쓰는 것과 같은 관용구다 — 서버 값과 같을 때만 출처를 말한다.
  const dayRollup = daySlots && daySlots.length > 1 ? rollupDay(daySlots) : null;
  const pristine = status === initialStatus && (units ?? null) === (initialUnits ?? null);
  const day = pristine ? dayRollup : null;
  // 세지 않는 교시는 **값이 비어 있을 때만** 빗금으로 드러낸다 — 값이 있으면 그 값이 칸의 주인이고,
  // 세지 않는 교시는 아래 툴팁에서 계속 밝힌다.
  // 🔴 **서버가 값을 안 준 칸일 때만** 빗금이다(initialStatus === null). 값이 있던 칸을 지우면 남는 건
  //    자리(JJ·랩실) 행뿐이다 — 강사 보기의 지우기는 다른 선생님 교시가 섞인 칸을 막고 자리 행은 남긴다
  //    (원장 2026-09-12). 그런데 그 행의 상태·메모는 이 칸이 모르므로, 여기서 빗금·유령 메모를 켜면
  //    **방금 지운 내 메모**를 남의 기록으로 그린다. 새로고침(900ms) 뒤 서버가 빗금으로 다시 그린다
  //    (적대적 리뷰 2026-08-19와 같은 결).
  const ghost = initialStatus === null && !status && !!otherSlots?.length;
  const sharedOthers = sharedOtherSlots(otherSlots);
  const seatOthers = (otherSlots?.length ?? 0) - sharedOthers.length;
  /**
   * 입력하면 **다른 선생님 교시에 상태만 옮기는** 빗금 칸인가(원장 2026-09-14) — 격자·조회와 같은 판정(`ghostCellKind`).
   * 서버가 준 값(`initialStatus`·`derived`)으로만 가른다 — 칠한 낙관값에 흔들리면 같은 칸의 팝오버가 순간마다 바뀐다.
   */
  const transfer =
    ghostCellKind({ hasValue: initialStatus !== null, derivedValue: !!derived, others: otherSlots }) === "transfer";
  // 🔴 빗금 칸엔 값이 없어도 **메모는 있다** — 실측 78칸이 결석 사유였다("병결"·"가족여행").
  //    noteVal은 값이 없으면 비우는 규약(지워진 칸의 유령 메모 방지)이라, 이 칸만 따로 살린다.
  const ghostNote = ghost ? noteEdit ?? note ?? "" : "";
  const display = cellDisplay(status, units, {
    attendDay,
    muted,
    holiday,
    outside,
    day,
    ghost,
    ghostMark: ghostValue ? { s: ghostValue.s as AttendanceMark, u: ghostValue.u } : null,
  });
  const fromReport = derived && status === initialStatus;
  /**
   * 보강 예약 칸 — **값이 없을 때만** 네 글자로 선다(값이 찍히면 그 값이 칸의 주인이고, 서버가 예약을 이행 처리한다).
   * 🔴 값이 아니라 표시다 — 격자 저장소엔 안 들어가므로 시수·출석률·복사·범위 채우기가 이 칸을 빈 칸으로 다룬다.
   */
  const reservedShown = !!reservation && !status && !editing && !ghost;
  // 🔴 툴팁은 **카드**다(원장 2026-09-15 *"툴팁이 이렇게 생겼으면 좋겠어 메모같이 생기지 않고"*) — 칸은
  //    `data-tip` 한 줄만 달고, 문서마다 한 장인 [HoverTipLayer](@/components/hover-tip/hover-tip-layer)가 그린다.
  //    🔴 `title`로 되돌리지 말 것(카드 옆에 회색 메모 상자가 겹친다) · 칸이 수천 개라 칸마다 카드 컴포넌트를
  //    다는 것도 금지다(그게 곧 반응속도다).
  // 잠긴 칸이라도 **메모는 보여 준다** — 잠금 사유만 남기고 메모를 감추면 왜 잠겼는지만 알고 뭐라 적혔는지는 못 본다.
  const tip = tipProps({
    title: studentName ?? null,
    meta: monthDayLabel(sessionDate),
    rows: [
      locked ? [t("att.tip.lock"), locked] : null,
      status ? [t("att.tip.status"), statusTextOf(status, lang)] : null,
      // 교시가 여럿인 날 — 칸엔 합계 하나뿐이라, 무엇을 접었는지 여기서 펼쳐 준다.
      day ? [t("att.tip.periods"), tf("att.cell.nPeriods", { n: day.count, breakdown: slotBreakdown(day.slots, lang) })] : null,
      // 이 표가 안 세는 교시(자리·남의 교시) — 숫자엔 없지만 기록은 있다는 사실 + **누가 찍었는지**(원장 2026-09-15).
      otherSlots?.length ? [t("att.legend.ghost"), ghostSlotLines(otherSlots, lang).join(NEWLINE)] : null,
      // 보강 예약 — 결석분·시각·예약자·메모(한글 단일 소스). 값이 찍힌 칸엔 서버가 이미 뺐다.
      reservation && !status
        ? [
            t("att.cell.reserved"),
            reservationDetail({ ...reservation, makeupDate: sessionDate }, { createdByName: reservation.createdByName }),
          ]
        : null,
      noteVal || ghostNote ? [t("att.tip.memo"), noteVal || ghostNote] : null,
    ],
    lines: [
      status && seatOthers > 0 ? t("att.cell.seatKept") : null,
      transfer && !locked ? t("att.cell.ghostTransfer") : null,
      // 회색 칸의 뜻을 말해 준다 — 색만 다르면 "왜 여기만 회색이지"로 끝난다.
      outside ? t(status ? "att.cell.outsideRecord" : "att.cell.outside") : null,
      // 칩의 예외 — 교시가 안 찍힌 기록이라 이 반 담당 전원에게 같은 값이 잡힌다(위 sharedDay 주석).
      sharedDay ? t("att.cell.sharedDay") : null,
      fromReport ? t("att.cell.fromReport") : null,
    ],
  });

  const openPopoverAt = (el: HTMLElement | null) => {
    if (!el) return;
    const selected = ctx?.store.selected;
    // 범위 팝오버는 상태를 고르는 단추뿐이라 읽기 권한엔 열지 않는다 — 이 칸의 읽기 팝오버가 대신 선다.
    setRangeKeys(!readOnly && selected && selected.size > 1 && selected.has(key) ? new Set(selected) : null);
    const r = el.getBoundingClientRect();
    const vh = typeof window !== "undefined" ? window.innerHeight : 9999;
    // 아래 공간이 팝오버 높이(~300px)보다 좁으면 위로 뒤집는다 — 마지막 행에서 저장 버튼이 화면 밖으로 안 나가게.
    const openUp = vh - r.bottom < 300 && r.top > vh - r.bottom;
    setPopover(openUp ? { x: r.left, bottom: vh - r.top + 4 } : { x: r.left, top: r.bottom + 4 });
  };
  // 🔴 **잠긴 칸도 연다** — 메모는 7일 창의 적용을 받지 않는다(원장 2026-08-06: "메모는 언제든 추가할 수 있어야").
  //    팝오버가 잠금 사유를 띄우고 메모만 열어 준다. 예전엔 아무 반응이 없어 "더블클릭이 안 된다"로 보였다.
  // ⚠️ 우클릭은 **항상** 기본 메뉴를 막는다 — 안 막으면 잠긴 칸에서 브라우저 메뉴가 튀어나온다.
  const openPopover = (e: React.MouseEvent) => {
    e.preventDefault();
    openPopoverAt(e.currentTarget as HTMLElement);
  };

  return (
    <>
      <div
        ref={ref}
        data-cell-key={key}
        role="gridcell"
        aria-selected={state.selected || state.active}
        tabIndex={state.active || isFirst ? 0 : -1}
        aria-label={`${sessionDate} ${
          status ? statusTextOf(status, lang) : reservedShown ? t("att.cell.reserved") : t("att.cell.unmarked")
        }${day ? tf("att.cell.andNPeriods", { n: day.count - 1 }) : ""}${
          otherSlots?.length ? tf("att.cell.ghostCount", { n: otherSlots.length }) : ""
        }`}
        {...tip}
        // 색이 갈린 교시가 섞인 날만 — 인라인 배경이 클래스 배경을 이긴다(글자색은 클래스 그대로).
        style={display.style}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse" || e.button !== 0) return;
          if (e.target instanceof Element && e.target.closest('button,input,a,[role="button"]')) return;
          ctx?.startSelection(e.pointerId);
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          if (e.target instanceof Element && e.target.closest('button,input,a,[role="button"]')) return;
          e.preventDefault();
          ctx?.selectCell(row, sessionDate, e.shiftKey);
          if (state.active) e.currentTarget.focus({ preventScroll: true });
        }}
        // ⚠️ 이 칸 **안의 입력칸**이 포커스를 받아도 여기로 버블한다 — 이미 활성이면 손대지 않는다
        //    (안 그러면 타이핑을 시작하는 순간 버퍼가 확정돼 버린다).
        onFocus={() => {
          if (!state.active && !ctx?.store.selected.has(key)) ctx?.selectCell(row, sessionDate, false);
        }}
        onKeyDown={(e) => {
          if (e.key === " " && !editing) {
            e.preventDefault();
            openPopoverAt(ref.current);
          }
        }}
        onDoubleClick={openPopover}
        onClick={(event) => {
          if (!editing && event.target instanceof Element && !event.target.closest("button,input,a") && isDirectEditClick(event)) {
            openPopover(event);
          }
        }}
        onContextMenu={openPopover}
        // `scroll-mt` — 방향키 이동 시 활성 칸이 고정 헤더 뒤로 숨지 않게(cell-display.ts 주석 참조).
        className={`absolute inset-0 flex items-center justify-center text-xs font-bold select-none ${CELL_SCROLL_MARGIN} ${
          reservedShown ? RESERVED_CELL_CLASS : display.className
        } ${locked ? "cursor-not-allowed" : "cursor-cell"}`}
      >
        {reservedShown && lang === "en" ? (
          /* 영어 화면 — 사분면 한글은 뜻이 없어 짧은 영문 하나(사전). */
          <span aria-hidden className="text-xs leading-none font-bold">
            {t("att.cell.reservedShort")}
          </span>
        ) : reservedShown ? (
          /* '보강 예약' — 사분면마다 한 글자(원장 2026-09-14). 칸이 30px라 한 줄엔 못 들어간다. */
          <span aria-hidden data-help="att-reserve" className="grid h-full w-full grid-cols-2 grid-rows-2 place-items-center leading-none">
            {RESERVED_CELL_CHARS.map((ch, i) => (
              <span key={i} className="text-xs font-bold">
                {ch}
              </span>
            ))}
          </span>
        ) : editing ? (
          <input
            autoFocus
            type="text"
            inputMode="decimal"
            aria-label={t("att.cell.unitsAria")}
            value={state.buffer ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^[0-9]*[.,]?[0-9]*$/.test(v)) ctx?.store.setBuffer(v.replace(",", "."));
            }}
            onKeyDown={(e) => {
              // 인라인 input 안에서는 문서 리스너가 비켜 있으므로(입력칸 무시) 여기서 직접 처리한다.
              const moves: Record<string, [number, number]> = {
                Enter: [0, e.shiftKey ? -1 : 1],
                Tab: [e.shiftKey ? -1 : 1, 0],
                ArrowUp: [0, -1],
                ArrowDown: [0, 1],
              };
              const d = moves[e.key];
              if (d) {
                e.preventDefault();
                ctx?.commitAndMove(d[0], d[1]);
              } else if (e.key === "Escape") {
                e.preventDefault();
                ctx?.store.setBuffer(null);
              }
            }}
            className="text-primary absolute inset-0 h-full w-full border-0 bg-white/90 p-0 text-center text-xs font-bold outline-none"
          />
        ) : display.faded ? (
          // 빗금 칸의 남의 교시 값 — 이 표 몫이 아니라 흐리게(원장 2026-09-14 "빗금 위에 값을 보여주고 합계엔 안 넣는다").
          <span className="opacity-50">{display.text}</span>
        ) : (
          display.text
        )}

        {/* 범위 선택 — 반투명 파란 덮개(시트 selection). */}
        {state.selected && !state.active ? (
          <span
            aria-hidden
            className="ring-primary/40 pointer-events-none absolute inset-0 z-20 bg-blue-500/20 ring-1 ring-inset"
          />
        ) : null}
        {/* 활성 칸 테두리 */}
        {state.active && !editing ? (
          <span aria-hidden className="ring-primary pointer-events-none absolute inset-0 z-30 ring-2 ring-inset" />
        ) : null}
        {/* Ctrl+C 복사 표시 — 시트의 점선 */}
        {state.copied && !state.active ? (
          <span
            aria-hidden
            className="border-primary pointer-events-none absolute inset-0 z-30 border-2 border-dashed"
          />
        ) : null}
        {/* 드래그 채우기 손잡이 — 활성 칸 우하단 */}
        {/* 빗금 칸의 흐린 값은 채우기 원본이 아니다 — 손잡이를 안 띄운다(씨앗이 비어 끌면 '지우기'가 된다, 적대 리뷰 2026-09-14). */}
        {state.active && !editing && !locked && !ghostValue ? (
          <span
            role="button"
            aria-label={t("att.cell.fillHandle")}
            title={t("att.cell.fillHandle")}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ctx?.startFill();
            }}
            className="bg-primary absolute right-[-2px] bottom-[-2px] z-40 size-1.5 cursor-crosshair ring-1 ring-white"
          />
        ) : null}
        {/* 메모 — 포스트잇 모서리 접힘(구 출석부 표기) */}
        {noteVal || ghostNote ? (
          <span
            aria-hidden
            className="pointer-events-none absolute top-0 right-0 size-2"
            style={{
              background: "linear-gradient(225deg,#fbbf24 0%,#f59e0b 48%,rgba(0,0,0,0.25) 50%,transparent 51%)",
            }}
          />
        ) : null}
      </div>

      {popover && rangeKeys && ctx ? (
        <RangeStatusPopover
          count={rangeKeys.size}
          anchor={popover}
          onPick={(nextStatus) => ctx.setRangeStatus(rangeKeys, nextStatus)}
          onClose={() => setPopover(null)}
        />
      ) : popover && transfer && !locked && ctx ? (
        // 빗금 칸 — 상태만 고른다(시수·메모·지우기 없음). 저장은 격자와 같은 문(`transferGhost` → writeOne).
        <GhostTransferPopover
          status={ghostValue?.s ?? null}
          note={noteVal || ghostNote}
          anchor={popover}
          onClose={() => setPopover(null)}
          onPick={(s) => ctx.transferGhost(key, s)}
        />
      ) : popover ? (
        <CellPopover
          studentId={studentId}
          classId={classId}
          sessionDate={sessionDate}
          status={status}
          // 🔴 '행 없음'은 상태가 아니라 **기록**으로 판정한다 — 수업보고서 파생 칸은 상태가 보여도 행이 없어
          //    저장하면 서버가 새 행(수학 자동 시수)을 만든다. 격자 낙관값과 같은 함수(isRecordless).
          recorded={ctx ? !isRecordless(state.value) : initialStatus !== null && !derived}
          units={units}
          note={noteVal || ghostNote}
          locked={locked ?? null}
          readOnly={readOnly}
          otherCount={otherSlots?.length ?? 0}
          anchor={popover}
          // 값이 찍힌 칸(결석 등)에서도 예약 정보·취소가 보여야 한다(서버는 `reserved`만 내려준다 — 이행되면 사라진다).
          reservation={reservation}
          // 읽기 권한엔 '보강 예약' 항목을 세우지 않는다(서버 `reserveMakeup`도 같은 출석부 쓰기 게이트).
          onReserve={
            readOnly
              ? undefined
              : () => {
                  setPopover(null);
                  setReserveOpen(true);
                }
          }
          onClose={() => setPopover(null)}
          onSaved={(next, opts) => {
            const token = (opts?.ifStill ?? null) as CellPaint | null;
            if (opts?.revert) {
              // 저장 실패 — 칸이 아직 이 쓰기의 것이면 칠하기 전으로(덮개가 없었으면 벗겨 서버 값을 보인다 — 파생 칸의 `d`까지
              // 그대로), 앞 쓰기가 응답을 기다리던 자리면 그 결과를 따라간다(paint-chain.ts). 값을 새로 만들어 칠하면 `d`가
              // 빠져 덮개가 새로고침 전까지 남고, 빈 칸('지우기')은 값으로 못 가려 아예 안 돌아왔다(재리뷰 2026-09-11).
              if (token?.value) ctx?.store.revertLocal(key, token.value);
              if (token?.note) revertNote(token.note);
              return token;
            }
            if (opts) {
              // 성공 응답 — 서버가 실제로 넣은 값으로 맞추고(그 사이 같은 칸을 또 고쳤으면, 즉 칸의 주인이 바뀌었으면 늦은 응답이
              // 새 입력을 덮지 않는다) 이 쓰기가 **끝났다**는 결과를 표식에 남긴다 — 뒤 쓰기의 되돌리기와 메모 따라잡기가 읽는다.
              // 메모는 서버가 고치지 않으니 칠한 그 글이 결과다.
              // 🔴 값은 격자 단건 저장(pushCell)과 같은 규약 — 서버가 새 행에 넣은 시수가 오면 그 값, 아니면 **칠한 그 값**.
              const settled: GridValue = !next.status
                ? null
                : next.serverUnits !== undefined
                  ? { s: next.status, u: next.serverUnits }
                  : (token?.shown ?? { s: next.status, u: next.units });
              if (token?.value) ctx?.store.correctLocal(key, token.value, settled);
              if (token?.note) token.note.fate = { value: next.note ?? "" };
              return token;
            }
            // 칠하기 **직전** 자리를 잡은 표식 — 팝오버가 응답 보정·실패 되돌리기 때 그대로 돌려준다
            // (격자 단건 pushCell이 `prev`를 칠하는 순간 잡는 것과 같은 규약).
            // 🔴 메모를 안 보낸 저장(상태 버튼)은 메모를 칠하지도 가져가지도 않는다 — 가져가면 응답 대기 중인 앞 메모 저장의
            //    실패가 이 저장 몫으로 삼켜져 저장 안 된 메모가 남는다. 옛 메모 덮개는 서버 따라잡기(위 seenNote)가 벗긴다
            //    (""를 미리 칠하면 남의 교시 메모를 가리거나 실패한 삭제 뒤에 굳었다 — 재리뷰 2026-09-11).
            // 🔴 잠긴 칸의 '메모만 저장'(`noteOnly`)은 값을 칠하지 않는다 — 서버는 값을 안 건드리는데 화면만 칠하면, 새로고침 전에
            //    서버 값이 바뀌었을 때 그 덮개가 서버와 달라져 영영 안 벗겨졌다. 서버가 이미 확정한 뒤 부르는 경로라 메모 표식도
            //    곧바로 '끝남'이다(안 그러면 따라잡기가 응답 대기로 보고 옛 사유를 붙든다 — 재리뷰 2026-09-11).
            // 🔴 칠할 값은 **격자 타이핑과 같은 함수**(ctx.toValue = optimisticGridValue + 그날 교시 수 + 수학 자동 시수)로
            //    만든다 — 따로 만들면 교시가 둘 이상인 칸(강사 보기의 내 교시 둘)에서 '출석'이 1로 칠해지는데 서버 합은 2라,
            //    덮개가 서버와 같아지지 않아 새로 고쳐도 1에 굳었다(리뷰 2026-09-11, 원장 제보와 같은 증상).
            const v: GridValue = !next.status
              ? null
              : ctx && next.unitsRaw !== undefined
                ? ctx.toValue(key, { status: next.status, units: next.unitsRaw }, ctx.store.valueOf(key))
                : { s: next.status, u: next.units };
            const painted: CellPaint = {
              value: next.noteOnly ? null : ctx?.store.paintLocal(key, v) ?? null,
              note: next.note === undefined ? null : paintNote(next.note),
              shown: v,
            };
            if (next.noteOnly && painted.note) painted.note.fate = { value: next.note ?? "" };
            return painted;
          }}
        />
      ) : null}
      {reserveOpen && !readOnly ? (
        /* 포털이라 DOM은 body지만 React 이벤트는 이 칸으로 버블한다 — 칸 선택·팝오버 열기에 안 닿게 창이 스스로 막는다. */
        <MakeupReserveDialog
          studentId={studentId}
          studentName={studentName ?? ""}
          classId={classId}
          className={className ?? ""}
          absenceDate={sessionDate}
          scopeTeacherId={scopeFieldsFor(scope, classId).scopeTeacherId ?? null}
          onClose={() => setReserveOpen(false)}
        />
      ) : null}
    </>
  );
}
