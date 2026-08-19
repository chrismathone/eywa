"use client";

import { useState, useTransition } from "react";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import type { AttendanceStatus } from "@/features/attendance/server/queries";
import { parseSessionUnits } from "@/features/attendance/session-units";
import { NOT_MINE_MESSAGE, STATUS_TONE } from "@/features/attendance/cell-display";

const OPTIONS: { value: AttendanceStatus; name: string }[] = [
  { value: "present", name: "출석" },
  { value: "absent", name: "결석" },
  { value: "late", name: "지각" },
  { value: "early_leave", name: "조퇴" },
  { value: "makeup", name: "보강" },
];

export type PopoverAnchor = { x: number; top?: number; bottom?: number };

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
  units,
  note,
  locked,
  otherCount = 0,
  sharedDelete = false,
  anchor,
  onClose,
  onSaved,
}: {
  studentId: string;
  classId: string;
  sessionDate: string;
  status: AttendanceStatus | null;
  units: number | null;
  note: string;
  /** 수정 기간(7일)이 지나 상태·시수를 못 고치는 칸 — 이유를 담은 문장. null = 제한 없음. */
  locked?: string | null;
  /**
   * 이 표가 세지 않는 교시 수(강사 전체 보기의 빗금 칸) — **"기록이 없다"와 "내 기록이 없다"를 가른다.**
   * 0보다 크면 그 날 기록은 **있다**(남의 교시 것). 이걸 안 보면 아래 안내가 사실과 반대로 나간다.
   */
  otherCount?: number;
  /**
   * 이 칸을 **지우면 남의 교시·자리 기록까지 사라지나** — 격자의 `alsoWrites`와 같은 정의
   * (서버가 준 값이 있고 + 이 표가 안 세는 교시도 있는 칸).
   *
   * 🔴 격자에만 가드를 걸면 이 팝오버가 그 가드를 통째로 우회한다 — 여긴 서버 액션을 **직접** 부른다.
   *    한 레코드의 모든 표면이 같은 게이트를 통과해야 한다(#77). 잠금(7일)과 달리 이 규칙은
   *    `locked`로 표현되지 않아(값이 있는 칸이라 편집은 열려 있다) 따로 받는다.
   */
  sharedDelete?: boolean;
  anchor: PopoverAnchor;
  onClose: () => void;
  onSaved: (next: { status: AttendanceStatus | null; units: number | null; note: string }) => void;
}) {
  const [unitsDraft, setUnitsDraft] = useState(units !== null && units !== 1 ? String(units) : "");
  const [noteDraft, setNoteDraft] = useState(note);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();
  // 잠겼는데 기록도 없으면 손댈 게 없다 — 사유만 알리고 입력은 안 연다.
  const noteOnly = !!locked;
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
      });
      setSaving(false);
      if (res && "error" in res) {
        setErr(res.error);
        return;
      }
      onSaved({ status, units, note: noteDraft.trim() });
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
    }
    setErr(null);
    onSaved({ status: next, units: parsedUnits, note: next === null ? "" : withNote ? noteDraft.trim() : note });
    onClose();
    startTransition(async () => {
      const res = await setAttendanceCell({
        studentId,
        classId,
        sessionDate,
        status: next,
        ...(next === null ? {} : { units: unitsDraft, ...(withNote ? { note: noteDraft } : {}) }),
      });
      // 실패하면 격자를 원래 값으로 되돌린다(저장된 척 두지 않는다).
      if (res && "error" in res) onSaved({ status, units, note });
    });
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-label="출결 상세 입력"
        // ⚠️ role="dialog" 는 접근성 표시이자 **격자 키 가로채기 방지 신호**다(grid-context의 가드가 이걸 본다).
        className="bg-card border-line fixed z-50 flex w-44 flex-col gap-0.5 rounded-lg border p-1 shadow-lg"
        style={{
          left: Math.min(anchor.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 190),
          top: anchor.top,
          bottom: anchor.bottom,
        }}
      >
        {noteOnly ? (
          <div className="flex flex-col gap-1 p-0.5">
            <p className="text-amber text-[10px] leading-tight">{locked}</p>
            {nothingToEdit ? (
              // 붙일 행이 없다 — 없는 출결을 지어내지 않는다(#메모는 기록에 딸린 것).
              // ⚠️ 다만 **빗금 칸은 기록이 있다**(남의 교시). 그 경우엔 사유가 다르므로 문장도 다르다.
              <div className="flex flex-col gap-1">
                {/* ⚠️ 잠금 사유가 이미 같은 말을 했으면 **반복하지 않는다**(빗금 칸의 기본 경로).
                    7일 잠금과 겹칠 때만 두 문장이 서로 다른 정보를 담는다. */}
                {hasOtherRecords && locked === NOT_MINE_MESSAGE ? null : (
                  <p className="text-text-dim text-[11px] leading-tight">
                    {hasOtherRecords
                      ? "이 날 기록은 다른 교시 것이라 여기서는 못 고칩니다 — 반별 보기에서 고치세요"
                      : "기록이 없는 날이라 메모만 남길 수는 없습니다 — 관리자에게 요청하세요"}
                  </p>
                )}
                {/* 남의 교시에 달린 메모(결석 사유 등)는 **읽기로는 보여 준다** — 여기서 감추면
                    "병결"·"가족여행" 같은 사유가 화면에서 사라진다(실측 78칸). */}
                {hasOtherRecords && note ? (
                  <p className="text-foreground text-[11px] leading-tight break-keep">메모 · {note}</p>
                ) : null}
              </div>
            ) : (
              <>
                <p className="text-text-dim text-[10px] leading-tight">메모는 기간과 무관하게 고칠 수 있습니다</p>
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
                  placeholder="메모(사유)"
                  aria-label="메모(사유)"
                  className={`bg-bg-soft text-foreground placeholder:text-text-faint w-full rounded-md border px-2 py-1 text-xs focus:outline-none ${
                    err ? "border-danger" : "border-line"
                  }`}
                />
                {err ? <p className="text-danger text-[10px] leading-tight">{err}</p> : null}
                <button
                  type="button"
                  onClick={applyNoteOnly}
                  disabled={saving}
                  className="bg-foreground text-background rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-40"
                >
                  {saving ? "저장 중…" : "메모 저장"}
                </button>
              </>
            )}
          </div>
        ) : null}
        {noteOnly ? null : (
          <>
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => apply(o.value, false)}
                className={`hover:bg-bg-soft flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-xs transition ${
                  status === o.value ? "font-bold" : ""
                }`}
              >
                {o.name}
                <span
                  className={`border-line size-4 shrink-0 rounded-sm border ${STATUS_TONE[o.value]}`}
                  aria-hidden
                />
              </button>
            ))}
            <div className="border-line mt-0.5 flex flex-col gap-1 border-t pt-1">
              <input
                type="text"
                inputMode="decimal"
                value={unitsDraft}
                onChange={(e) => {
                  setUnitsDraft(e.target.value);
                  setErr(null);
                }}
                placeholder="시수(기본 1)"
                aria-label="시수"
                title="정규 수업 1회 = 1. 보강 연장 1.5·2, 부분 출석 0.5 등"
                className={`bg-bg-soft text-foreground placeholder:text-text-faint w-full rounded-md border px-2 py-1 text-xs focus:outline-none ${
                  err ? "border-danger" : "border-line"
                }`}
              />
              {err ? <p className="text-danger text-[10px] leading-tight">{err}</p> : null}
              <input
                type="text"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="메모(사유)"
                aria-label="메모(사유)"
                className="border-line bg-bg-soft text-foreground placeholder:text-text-faint w-full rounded-md border px-2 py-1 text-xs focus:outline-none"
              />
              <button
                type="button"
                onClick={() => apply(status, true)}
                disabled={!status}
                className="bg-foreground text-background rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-40"
                title={status ? undefined : "상태를 먼저 선택하세요"}
              >
                저장
              </button>
            </div>
            {status && !sharedDelete ? (
              <button
                type="button"
                onClick={() => apply(null, false)}
                className="text-text-dim hover:bg-bg-soft rounded-md border-t px-2 py-1 text-left text-xs"
              >
                지우기
              </button>
            ) : null}
            {/* 🔴 사정거리도 격자와 **같은 말**로 알린다 — 저장은 교시를 못 가려 그날 모든 교시에 가고,
                지우기는 그날 행을 통째로 없앤다(그래서 저장은 열고 지우기만 닫는다). */}
            {status && sharedDelete ? (
              <p className="text-text-dim border-t px-2 py-1 text-[10px] leading-tight break-keep">
                고치면 같은 날 다른 교시 기록 {otherCount}건(다른 선생님·자리 JJ·랩실)도 함께 바뀝니다. 지우기는
                여기서 못 합니다 — 반별 보기에서 지우세요
              </p>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
