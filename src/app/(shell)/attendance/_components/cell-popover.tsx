"use client";

import { useState, useTransition } from "react";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import type { AttendanceStatus, MatrixReservation } from "@/features/attendance/server/queries";
import { cancelMakeupReservation } from "@/features/attendance/server/makeup-reservation-actions";
import { RESERVED_BADGE_CLASS, reservationSpanLabel } from "@/features/attendance/makeup-reservation";
import { shortDate } from "@/features/onescreen/makeup-absence-link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  COUNTABLE_STATUSES,
  formatSessionUnits,
  isDefaultUnitsRaw,
  parseSessionUnits,
} from "@/features/attendance/session-units";
import { canonicalUnitsRaw } from "@/features/attendance/grid/typing";
import { useAutoUnits } from "./grid-context";
import { scopeFieldsFor, useAttendanceScope } from "./scope-context";
import { NOT_MINE_MESSAGE, STATUS_TONE, statusTextOf } from "@/features/attendance/cell-display";
// 화면 언어 — 상태 이름은 `statusTextOf`(한글 맵 옆) 단일 소스, 나머지 문구는 사전.
import { useSheetLang, useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";

/**
 * 🔴 이름을 여기 적지 않는다 — 표·범례와 **같은 표**를 읽어야 같은 낱말이 된다.
 * 빗금 칸 팝오버(`ghost-popover.tsx`)도 이 목록을 쓴다 — 두 팝오버가 고를 수 있는 상태가 갈리지 않게.
 */
export const STATUS_OPTIONS: AttendanceStatus[] = ["present", "absent", "late", "early_leave", "makeup"];

export type PopoverAnchor = { x: number; top?: number; bottom?: number };

/** 칸 옆 자리 — 오른쪽 끝에서 잘리지 않게 창 폭 안으로 당긴다(두 팝오버 공용). */
export function popoverPosition(anchor: PopoverAnchor): { left: number; top?: number; bottom?: number } {
  return {
    left: Math.min(anchor.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 190),
    top: anchor.top,
    bottom: anchor.bottom,
  };
}

/**
 * 칸 상세 입력 — **숫자로 표현할 수 없는 것**(지각·조퇴·보강·메모)을 담당한다.
 * 출석(1)·결석(0)·시수는 격자에서 그냥 타이핑하는 게 빠르므로 여기 오지 않아도 된다.
 * 여는 법: 칸 우클릭(더블클릭도 같음).
 *
 * 🔴 **잠긴 칸(7일 초과)에서도 열린다 — 단 메모만.** 메모는 돈(시수·출석률)을 안 건드리므로 기간 제한의
 *    이유가 없고, 뒤늦게 사유를 적어 두는 게 운영이다(원장 2026-08-06: "메모는 언제든 추가할 수 있어야").
 *    상태·시수·지우기는 그대로 잠근다 — 그건 급여·출석률이 읽는 값이다.
 * ⚠️ 기록이 **아예 없는** 잠긴 칸엔 메모를 못 붙인다(메모가 붙을 행이 없다 — 없는 출결을 지어내지 않는다).
 */
export function CellPopover({
  studentId,
  classId,
  sessionDate,
  status,
  recorded: recordedProp,
  units,
  note,
  locked,
  readOnly = false,
  otherCount = 0,
  anchor,
  reservation = null,
  onReserve,
  onClose,
  onSaved,
}: {
  studentId: string;
  classId: string;
  sessionDate: string;
  status: AttendanceStatus | null;
  /** 이 칸에 걸린 보강 예약(0264a, 값이 없는 칸일 때만) — 정보 블록 + '예약 취소'. */
  reservation?: MatrixReservation | null;
  /** '보강 예약' 항목 — 칸이 팝오버를 닫고 예약 창을 연다. 없으면 항목이 안 선다(테스트·단독 렌더). */
  onReserve?: () => void;
  /**
   * 이 칸에 **출결 행**이 있는가 — 상태가 보여도 수업보고서 파생 칸은 행이 없다(저장하면 서버가 **새 행**을
   * 만들어 수학 자동 시수를 넣는다, auto-units.ts). 생략하면 `status`가 있으면 있음(종전 의미).
   */
  recorded?: boolean;
  units: number | null;
  note: string;
  /** 수정 기간(7일)이 지나 상태·시수를 못 고치는 칸 — 이유를 담은 문장. null = 제한 없음. */
  locked?: string | null;
  /**
   * 출석부 **읽기 권한**(격자 `readOnly`) — 상태·지우기·보강 예약·예약 취소 단추를 그리지 않고, 시수·메모는 잠근 칸으로
   * 값만 보인다(원장 2026-11-05). 7일 잠금의 '메모는 언제든'도 열지 않는다 — 메모 저장도 같은 쓰기 게이트다.
   */
  readOnly?: boolean;
  /**
   * 이 표가 세지 않는 교시 수(강사 전체 보기의 빗금 칸) — **"기록이 없다"와 "내 기록이 없다"를 가른다.**
   * 0보다 크면 그 날 기록은 **있다**(남의 교시 것). 이걸 안 보면 아래 안내가 사실과 반대로 나간다.
   */
  otherCount?: number;
  anchor: PopoverAnchor;
  onClose: () => void;
  /**
   * 격자에 반영. 돌려준 값은 **표식**이다(칠한 쓰기 · 칠하기 전 자리 · 그때 칸의 주인) — 응답 보정 때 `opts.ifStill`로
   * 되돌려 주면 받는 쪽은 그 칸이 아직 이 쓰기의 것일 때만 바꾼다(늦게 온 응답이 새 입력을 덮지 않게, store.correctLocal).
   * `opts.revert` = 저장 실패 — 받는 쪽은 `next`로 값을 새로 만들지 말고 **칠하기 전 자리**로 되돌린다(store.revertLocal —
   * 새로 만들면 파생 표식 `d`가 빠지고, 빈 칸 '지우기'는 값으로 못 가린다, 재리뷰 2026-09-11). 앞 쓰기가 아직 응답을
   * 기다리던 자리면 그 결과를 따라간다(paint-chain.ts). `next.note`가 없으면(undefined) 이 저장은 메모를 안 보낸다 —
   * 서버가 기존 메모를 두니 받는 쪽도 메모를 칠하지 않는다.
   */
  onSaved: (
    next: {
      status: AttendanceStatus | null;
      units: number | null;
      /** 시수 칸 **원문**("" = 기본) — 받는 쪽(칸)이 격자 타이핑과 같은 함수로 칠할 값을 만든다(교시 합·자동 시수). */
      unitsRaw?: string;
      /** 성공 응답에서 서버가 새 행에 **실제로 넣은** 시수(자동 시수 판정을 탔을 때만) — 격자 단건 저장과 같은 보정. */
      serverUnits?: number | null;
      note?: string;
      noteOnly?: true;
    },
    opts?: { ifStill: unknown; revert?: true },
  ) => unknown;
}) {
  const lang = useSheetLang();
  const t = useSheetT();
  const tf = useSheetTf();
  const [unitsDraft, setUnitsDraft] = useState(
    (recordedProp ?? status !== null) ? String(units ?? 1) : units !== null ? String(units) : "",
  );
  /**
   * 🔴 **빈 칸**에서 시수를 비운 채 저장하면 서버가 수학 자동 시수(수업 길이, auto-units.ts)를 넣는다 —
   *    그 값을 기본값으로 보여 주고 격자에도 같은 숫자로 칠한다(보이는 기본값 = 저장될 값).
   *    기록이 있는 칸의 빈 시수는 '1로 되돌리기'라(서버 update 규약 그대로) 여기서 자동값을 안 쓴다.
   * 🔴 '빈 칸'은 상태가 아니라 **행**으로 가른다 — 수업보고서 파생 '출석' 칸은 상태가 있어도 행이 없다
   *    (적대 리뷰 2026-09-11: 파생 칸에서 '기본 1'을 약속하고 서버는 1.5를 넣었다).
   */
  const recorded = recordedProp ?? status !== null;
  const autoHere = useAutoUnits(classId, sessionDate);
  const autoUnits = recorded ? null : autoHere;
  // 강사 전체 보기의 주인 — 격자 저장과 **같은 필드**를 싣는다(이 팝오버가 격자를 우회하는 문이 되지 않게, #77).
  const scope = useAttendanceScope();
  const [noteDraft, setNoteDraft] = useState(note);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  /**
   * '보강 예약' 항목 — 잠긴 칸(7일 지난 결석)에서도 선다: 지난 결석에 보강을 잡는 게 보통이고, 그때 결석 칸엔
   * **메모만** 붙어 잠금(돈)과 무관하다. 기록이 없는 잠긴 칸은 결석을 새로 찍어야 해서 서버가 거절한다(사유를 돌려준다).
   */
  const canReserve = !!onReserve && !reservation;
  const cancelReservation = () => {
    if (!reservation) return;
    setCancelling(true);
    startTransition(async () => {
      const res = await cancelMakeupReservation({ id: reservation.id });
      setCancelling(false);
      if ("error" in res) {
        setErr(res.error);
        return;
      }
      toast.success(tf("att.pop.cancelReserveDone", { span: reservationSpanLabel({ ...reservation, makeupDate: sessionDate }) }));
      onClose();
      router.refresh();
    });
  };
  // 잠겼는데 기록도 없으면 손댈 게 없다 — 사유만 알리고 입력은 안 연다.
  // 읽기 권한은 메모만 여는 갈래(7일 잠금)도 타지 않는다 — 아래 읽기 전용 블록이 대신 선다.
  const noteOnly = !!locked && !readOnly;
  const nothingToEdit = noteOnly && !status;
  // 🔴 **값이 없다 ≠ 기록이 없다.** 빗금 칸엔 남의 교시 기록이 있고, 거기에 "기록이 없는 날"이라고
  //    쓰면 화면이 스스로를 부정한다(잠금 사유는 "다른 교시 것"이라고 말하는데 그 아래에서 없다고 한다).
  const hasOtherRecords = otherCount > 0;

  /**
   * 메모만 저장 — 상태·시수는 서버에서도 건드리지 않는다(`noteOnly`).
   * ⚠️ 여기선 낙관적으로 닫지 **않는다** — 잠긴 칸은 서버가 거절할 수 있는 경우가 남아 있어(기록 없음 등)
   *    조용히 되돌리면 "적었는데 사라졌다"가 된다. 성공했을 때만 닫는다.
   */
  const applyNoteOnly = () => {
    setErr(null);
    setSaving(true);
    startTransition(async () => {
      const res = await setAttendanceCell({
        studentId,
        classId,
        sessionDate,
        status,
        note: noteDraft,
        noteOnly: true,
        // 🔴 강사 보기의 메모도 자리(JJ·랩실) 행에 달지 않는다(원장 2026-09-12) — 서버가 그 행을 후보에서 뺀다.
        ...scopeFieldsFor(scope, classId),
      });
      setSaving(false);
      if (res && "error" in res) {
        setErr(res.error);
        return;
      }
      // 메모만 — 값은 그대로라 칠하지 않는다(`noteOnly` — 칠하면 새로고침 전에 서버 값이 바뀔 때 덮개가 굳는다, attendance-cell 주석).
      onSaved({ status, units, note: noteDraft.trim(), noteOnly: true });
      onClose();
    });
  };

  const apply = (next: AttendanceStatus | null, withNote: boolean) => {
    let parsedUnits: number | null = null;
    if (next !== null) {
      const parsed = parseSessionUnits(unitsDraft);
      if (!parsed.ok) {
        setErr(parsed.error);
        return;
      }
      parsedUnits = parsed.value;
      // 빈 칸 + 시수 비움 + 시수를 쓰는 상태 → 서버가 넣을 자동값을 격자에도 먼저 칠한다(아래 응답으로 다시 맞춘다).
      if (autoUnits !== null && isDefaultUnitsRaw(unitsDraft) && COUNTABLE_STATUSES.has(next)) parsedUnits = autoUnits;
    }
    setErr(null);
    // 🔴 메모를 **안 보내는** 저장(상태 버튼)은 메모를 칠하지 않는다(undefined) — 서버는 기존 메모를 두는데 화면만 칠하면,
    //    응답 대기 중인 앞 메모 저장이 실패했을 때 그 메모가 이 저장의 것으로 남아 되돌아오지 않았다(재리뷰 2026-09-11).
    //    '지우기'는 행째 지우니 메모도 비운다("").
    const nextNote = next === null ? "" : withNote ? noteDraft.trim() : undefined;
    // 칠한 표식 — 아래 응답 보정·실패 되돌리기가 "칸이 아직 이 쓰기의 것일 때만" 움직이도록 되돌려 준다.
    // 시수 원문을 함께 넘긴다 — 칠할 값은 받는 쪽(칸)이 격자 타이핑과 같은 함수로 만든다(교시가 여럿인 칸의 합, 리뷰 2026-09-11).
    // 🔴 원문은 격자 타이핑과 **같은 정규화**(`canonicalUnitsRaw` — 쉼표 소수점 → 점)를 거친다. "1,5"를 그대로 넘기면 칸이
    //    NaN을 칠해 렌더가 무한히 돌고 화면이 통째로 오류로 떨어졌다(재리뷰 2026-09-11). 위에서 검증했으니 null은 안 온다.
    //    서버엔 원문을 그대로 보낸다(서버 parseSessionUnits가 같은 규칙으로 읽는다).
    const raw = next === null ? {} : { unitsRaw: canonicalUnitsRaw(unitsDraft) ?? "" };
    const token = onSaved({ status: next, units: parsedUnits, ...raw, note: nextNote });
    onClose();
    startTransition(async () => {
      const res = await setAttendanceCell({
        studentId,
        classId,
        sessionDate,
        status: next,
        ...(next === null ? {} : { units: unitsDraft, ...(withNote ? { note: noteDraft } : {}) }),
        // 🔴 강사 전체 보기 칸은 그 강사 몫 교시의 합 — 서버가 시수를 그 몫에만 나눈다(원장 제보 2026-09-11).
        ...scopeFieldsFor(scope, classId),
      });
      // 실패하면 격자를 원래 값으로 되돌린다(저장된 척 두지 않는다) — 그 사이 같은 칸에 새 입력이 들어갔으면
      // 그 입력을 지우지 않는다(칸의 주인, 성공 보정과 같은 규약). 돌아갈 자리는 표식에 들어 있다(`revert`).
      if (res && "error" in res) onSaved({ status, units, note }, { ifStill: token, revert: true });
      // 성공 — 서버가 실제로 넣은 값으로 맞추고(새 행 + 숫자 안 고른 저장이면 자동 시수, 조회 실패면 null=1) 이 쓰기가 끝났다는
      // 결과를 남긴다(뒤 쓰기의 되돌리기·메모 따라잡기가 읽는다 — 끝났는지 모르면 응답 대기로 봐야 해서 옛 메모가 굳었다).
      // 🔴 그 사이 같은 칸에 새 입력이 들어갔으면 덮지 않는다(칸의 주인이 바뀌었으면 받는 쪽이 거절 — store.correctLocal).
      else
        onSaved(
          {
            status: next,
            units: res?.autoUnits !== undefined ? res.autoUnits : parsedUnits,
            ...raw,
            ...(res?.autoUnits !== undefined ? { serverUnits: res.autoUnits } : {}),
            note: nextNote,
          },
          { ifStill: token },
        );
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label={t("att.pop.aria")}
        // ⚠️ role="dialog" 는 접근성 표시이자 **격자 키 가로채기 방지 신호**다(grid-context의 가드가 이걸 본다).
        className="bg-card border-line fixed z-50 flex w-44 flex-col gap-0.5 rounded-lg border p-1 shadow-lg"
        style={popoverPosition(anchor)}
      >
        {/* 예약된 칸(0264a) — 무엇의 보강인지·언제인지·누가 잡았는지 + 취소. 값을 찍는 항목들은 그 아래 그대로. */}
        {reservation ? (
          <div className={`mb-0.5 flex flex-col gap-1 rounded-md px-2 py-1.5 ${RESERVED_BADGE_CLASS}`}>
            <p className="text-xs font-bold leading-tight">
              {t("att.pop.reserved")}
              <span className="num ml-1 font-medium">
                {reservation.periodLabel ? `${reservation.periodLabel} · ` : ""}
                {reservation.slotStart}~{reservation.slotEnd}
              </span>
            </p>
            <p className="text-xs leading-tight">
              {tf("att.pop.reservedFor", { date: shortDate(reservation.absenceDate) })}
              {reservation.createdByName ? ` · ${tf("att.pop.reservedBy", { name: reservation.createdByName })}` : ""}
            </p>
            {reservation.note ? <p className="text-xs leading-tight break-keep">{reservation.note}</p> : null}
            <p className="text-xs leading-tight break-keep opacity-80">{t("att.pop.reservedTip")}</p>
            {noteOnly || readOnly ? null : (
              <button
                type="button"
                onClick={cancelReservation}
                disabled={cancelling}
                className="border-purple/40 hover:bg-purple/10 self-start rounded-md border px-2 py-0.5 text-xs font-medium disabled:opacity-40"
              >
                {cancelling ? t("att.pop.cancelling") : t("att.pop.cancelReserve")}
              </button>
            )}
          </div>
        ) : null}
        {readOnly ? (
          // 🔴 읽기 권한 — 쓰기 단추는 그리지 않고(상태 단추 대신 상태 글자), 시수·메모는 잠근 칸에 값만 싣는다.
          //    값이 차 있으면 placeholder가 안 보이므로 위 사유 문장이 늘 함께 선다(write-lock.ts 규칙).
          <div className="flex flex-col gap-1 p-0.5">
            <p className="text-amber text-xs leading-tight break-keep">{locked ?? writeLockedNote("attendance")}</p>
            {status ? <p className="text-foreground text-xs leading-tight font-bold">{statusTextOf(status, lang)}</p> : null}
            <input
              type="text"
              disabled
              // 평소 팝오버와 같은 규약 — 값이 있는 칸의 빈 시수는 1이다(unitsDraft 초기값).
              value={status !== null ? formatSessionUnits(units ?? 1) : ""}
              placeholder={writeLockedPlaceholder("attendance")}
              aria-label={t("att.pop.unitsAria")}
              className="border-line bg-bg-soft text-foreground placeholder:text-text-faint w-full rounded-md border px-2 py-1 text-xs opacity-70"
            />
            <input
              type="text"
              disabled
              value={note}
              placeholder={writeLockedPlaceholder("attendance")}
              aria-label={t("att.pop.notePh")}
              className="border-line bg-bg-soft text-foreground placeholder:text-text-faint w-full rounded-md border px-2 py-1 text-xs opacity-70"
            />
          </div>
        ) : null}
        {noteOnly ? (
          <div className="flex flex-col gap-1 p-0.5">
            <p className="text-amber text-xs leading-tight">{locked}</p>
            {/* 지난 결석에도 보강은 잡는다 — 결석 칸엔 메모만 붙어 잠금(시수·출석률)과 무관하다. */}
            {canReserve && status ? (
              <button
                type="button"
                onClick={onReserve}
                title={t("att.pop.reserveHint")}
                className={`flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-xs transition hover:bg-bg-soft`}
              >
                {t("att.pop.reserve")}
                <span className={`size-4 shrink-0 rounded-sm ${RESERVED_BADGE_CLASS}`} aria-hidden />
              </button>
            ) : null}
            {nothingToEdit ? (
              // 붙일 행이 없다 — 없는 출결을 지어내지 않는다(#메모는 기록에 딸린 것).
              // ⚠️ 다만 **빗금 칸은 기록이 있다**(남의 교시). 그 경우엔 사유가 다르므로 문장도 다르다.
              <div className="flex flex-col gap-1">
                {/* ⚠️ 잠금 사유가 이미 같은 말을 했으면 **반복하지 않는다**(빗금 칸의 기본 경로).
                    7일 잠금과 겹칠 때만 두 문장이 서로 다른 정보를 담는다. */}
                {hasOtherRecords && (locked === NOT_MINE_MESSAGE || locked === t("att.lock.seatOnly")) ? null : (
                  <p className="text-text-dim text-xs leading-tight">
                    {/* ⚠️ 사유 문장은 NOT_MINE_MESSAGE 단일 소스 — 여기 사본을 두면 사유가 늘 때
                        (2026-08-19 '담임 이전 기록') 한쪽만 고쳐져 같은 칸이 화면마다 다른 말을 한다. */}
                    {hasOtherRecords
                      ? NOT_MINE_MESSAGE
                      : t("att.pop.noRecord")}
                  </p>
                )}
                {/* 남의 교시에 달린 메모(결석 사유 등)는 **읽기로는 보여 준다** — 여기서 감추면
                    "병결"·"가족여행" 같은 사유가 화면에서 사라진다(실측 78칸). */}
                {hasOtherRecords && note ? (
                  <p className="text-foreground text-xs leading-tight break-keep">
                    {tf("att.pop.note", { note })}
                  </p>
                ) : null}
              </div>
            ) : (
              <>
                <p className="text-text-dim text-xs leading-tight">
                  {t("att.pop.noteAnytime")}
                </p>
                <input
                  autoFocus
                  type="text"
                  value={noteDraft}
                  onChange={(e) => {
                    setNoteDraft(e.target.value);
                    setErr(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyNoteOnly();
                    }
                  }}
                  placeholder={t("att.pop.notePh")}
                  aria-label={t("att.pop.notePh")}
                  className={`bg-bg-soft text-foreground placeholder:text-text-faint w-full rounded-md border px-2 py-1 text-xs focus:outline-none ${
                    err ? "border-danger" : "border-line"
                  }`}
                />
                {err ? <p className="text-danger text-xs leading-tight">{err}</p> : null}
                <button
                  type="button"
                  onClick={applyNoteOnly}
                  disabled={saving}
                  className="bg-foreground text-background rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-40"
                >
                  {saving ? t("att.pop.saving") : t("att.pop.saveNote")}
                </button>
              </>
            )}
          </div>
        ) : null}
        {noteOnly || readOnly ? null : (
          <>
            {STATUS_OPTIONS.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => apply(o, false)}
                className={`hover:bg-bg-soft flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-xs transition ${
                  status === o ? "font-bold" : ""
                }`}
              >
                {statusTextOf(o, lang)}
                <span
                  className={`border-line size-4 shrink-0 rounded-sm border ${STATUS_TONE[o]}`}
                  aria-hidden
                />
              </button>
            ))}
            {/* '보강' 바로 아래 — 이 날 결석분의 보강 시간을 미리 잡는다(원장 2026-09-14). 이미 예약된 칸엔 위 블록이 대신 선다. */}
            {canReserve ? (
              <button
                type="button"
                onClick={onReserve}
                title={t("att.pop.reserveHint")}
                className="hover:bg-bg-soft flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-xs transition"
              >
                {t("att.pop.reserve")}
                <span
                  className={`border-line size-4 shrink-0 rounded-sm border border-dashed ${RESERVED_BADGE_CLASS}`}
                  aria-hidden
                />
              </button>
            ) : null}
            <div className="border-line mt-0.5 flex flex-col gap-1 border-t pt-1">
              <input
                type="text"
                inputMode="decimal"
                value={unitsDraft}
                onChange={(e) => {
                  setUnitsDraft(e.target.value);
                  setErr(null);
                }}
                placeholder={
                  autoUnits !== null
                    ? tf("att.pop.unitsPhAuto", { n: formatSessionUnits(autoUnits) })
                    : t("att.pop.unitsPh")
                }
                aria-label={t("att.pop.unitsAria")}
                title={t("att.pop.unitsTitle")}
                className={`bg-bg-soft text-foreground placeholder:text-text-faint w-full rounded-md border px-2 py-1 text-xs focus:outline-none ${
                  err ? "border-danger" : "border-line"
                }`}
              />
              {err ? <p className="text-danger text-xs leading-tight">{err}</p> : null}
              <input
                type="text"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder={t("att.pop.notePh")}
                aria-label={t("att.pop.notePh")}
                className="border-line bg-bg-soft text-foreground placeholder:text-text-faint w-full rounded-md border px-2 py-1 text-xs focus:outline-none"
              />
              <button
                type="button"
                onClick={() => apply(status, true)}
                disabled={!status}
                className="bg-foreground text-background rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-40"
                title={status ? undefined : t("att.pop.pickFirst")}
              >
                {t("att.pop.save")}
              </button>
            </div>
            {status ? (
              <button
                type="button"
                onClick={() => apply(null, false)}
                className="text-text-dim hover:bg-bg-soft rounded-md border-t px-2 py-1 text-left text-xs"
              >
                {t("att.pop.clear")}
              </button>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
