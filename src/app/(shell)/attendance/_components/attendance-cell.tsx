"use client";

import { useState, useTransition } from "react";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import type { AttendanceStatus } from "@/features/attendance/server/queries";
import { COUNTABLE_STATUSES, formatSessionUnits, parseSessionUnits } from "@/features/attendance/session-units";

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  present: "O",
  absent: "X",
  late: "L",
  excused: "X",
  makeup: "보",
  early_leave: "조",
};
const STATUS_CLASS: Record<AttendanceStatus, string> = {
  present: "bg-primary-soft text-primary",
  absent: "bg-danger-soft text-danger",
  late: "bg-amber-soft text-amber",
  excused: "bg-danger-soft text-danger",
  makeup: "bg-purple-soft text-purple",
  early_leave: "bg-rose-soft text-rose",
};
const OPTIONS: { value: AttendanceStatus; name: string }[] = [
  { value: "present", name: "출석" },
  { value: "absent", name: "결석" },
  { value: "late", name: "지각" },
  { value: "early_leave", name: "조퇴" },
  { value: "makeup", name: "보강" },
];

/**
 * 출석부 매트릭스 인라인 셀 — 클릭 시 상태 팝오버, 낙관적 업데이트 후 단일 셀 저장.
 * 페이지 이동 없이 빠르게 출결을 찍는다(반응속도 1순위). 숙제 상세는 일자 입력 화면에서.
 * 시수(정규 1회 기준 배수): 기본 1은 상태 글자(O/L/보/조), 1이 아니면 숫자로 표시(구 출석부 표기 관행).
 */
export function AttendanceCell({
  studentId,
  classId,
  sessionDate,
  initialStatus,
  note,
  initialUnits,
}: {
  studentId: string;
  classId: string;
  sessionDate: string;
  initialStatus: AttendanceStatus | null;
  note?: string | null;
  initialUnits?: number | null;
}) {
  const [status, setStatus] = useState<AttendanceStatus | null>(initialStatus);
  const [units, setUnits] = useState<number | null>(initialUnits ?? null);
  const [noteVal, setNoteVal] = useState(note ?? "");
  const [draft, setDraft] = useState(note ?? "");
  const [unitsDraft, setUnitsDraft] = useState("");
  const [unitsError, setUnitsError] = useState(false);
  const [open, setOpen] = useState(false);
  // top(아래로 열기) 또는 bottom(위로 플립) 중 하나만 설정 — 하단 행에서 저장 버튼이 뷰포트 밖으로 나가는 것 방지.
  const [pos, setPos] = useState<{ x: number; top?: number; bottom?: number } | null>(null);
  const [, startTransition] = useTransition();

  // noteArg/unitsArg 전달 시 함께 갱신(undefined면 기존 유지). 상태/메모/시수 모두 낙관적.
  const apply = (next: AttendanceStatus | null, noteArg?: string, unitsArg?: string) => {
    // 시수는 클라에서 선검증 — 서버 왕복 전에 잘못된 입력을 붙잡는다(서버도 동일 파서로 재검증).
    let optimisticUnits: number | null | undefined = undefined;
    if (unitsArg !== undefined) {
      const parsed = parseSessionUnits(unitsArg);
      if (!parsed.ok) {
        setUnitsError(true);
        return;
      }
      optimisticUnits = parsed.value;
    }
    setUnitsError(false);
    const prevStatus = status;
    const prevNote = noteVal;
    const prevUnits = units;
    setStatus(next);
    if (noteArg !== undefined) setNoteVal(noteArg.trim());
    if (next === null) setUnits(null);
    else if (optimisticUnits !== undefined) setUnits(optimisticUnits);
    setOpen(false);
    startTransition(async () => {
      const res = await setAttendanceCell({
        studentId,
        classId,
        sessionDate,
        status: next,
        note: noteArg,
        units: unitsArg,
      });
      if ("error" in res) {
        setStatus(prevStatus);
        setNoteVal(prevNote);
        setUnits(prevUnits);
      }
    });
  };

  const cls = status ? STATUS_CLASS[status] : "";
  // 시수 ≠ 1 이면 숫자 표기(색은 상태 유지) — 구 출석부의 "숫자 = 몇 회분" 읽기 관행.
  const showUnits = status !== null && COUNTABLE_STATUSES.has(status) && units !== null && units !== 1;
  const label = status ? (showUnits ? formatSessionUnits(units!) : STATUS_LABEL[status]) : "·";
  const titleText =
    [showUnits ? `시수 ${formatSessionUnits(units!)}` : null, noteVal || null].filter(Boolean).join(" · ") ||
    undefined;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          // 아래 공간이 팝오버 높이(시수·메모 포함 ~300px)보다 좁으면 위로 플립.
          const EST_HEIGHT = 300;
          const spaceBelow = (typeof window !== "undefined" ? window.innerHeight : 9999) - r.bottom;
          const openUp = spaceBelow < EST_HEIGHT && r.top > spaceBelow;
          setPos(
            openUp
              ? { x: r.left, bottom: (typeof window !== "undefined" ? window.innerHeight : 0) - r.top + 4 }
              : { x: r.left, top: r.bottom + 4 },
          );
          setDraft(noteVal);
          setUnitsDraft(units !== null && units !== 1 ? formatSessionUnits(units) : "");
          setUnitsError(false);
          setOpen(true);
        }}
        title={titleText}
        className={`relative mx-auto block size-7 text-center leading-7 text-[11px] font-bold ${cls} ${
          status ? "" : "text-text-faint hover:bg-bg-soft"
        }`}
        aria-label={noteVal ? `출결 상태 변경 (메모: ${noteVal})` : "출결 상태 변경"}
      >
        {label}
        {noteVal ? (
          <span
            className="border-t-danger absolute top-0 right-0 size-0 border-t-[5px] border-l-[5px] border-l-transparent"
            aria-hidden
          />
        ) : null}
      </button>

      {open && pos ? (
        <>
          {/* 바깥 클릭 닫기 */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="bg-card border-line fixed z-50 flex flex-col gap-0.5 rounded-lg border p-1 shadow-lg"
            style={{
              // 팝오버 실폭 ≈ 입력칸 w-40(160) + 패딩·테두리 — 오른쪽 끝 셀에서 잘리지 않게 클램프.
              left: Math.min(pos.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 176),
              top: pos.top,
              bottom: pos.bottom,
            }}
          >
            {OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                // 시수 초안을 함께 커밋 — "시수 타이핑 → 상태 클릭" 순서에서 초안이 조용히 버려지는 것 방지.
                // (초안이 잘못된 값이면 apply가 에러 표시 후 중단 — 팝오버 유지)
                onClick={() => apply(o.value, undefined, unitsDraft)}
                className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-xs transition hover:bg-bg-soft ${
                  status === o.value ? "font-bold" : ""
                }`}
              >
                <span
                  className={`inline-flex size-5 items-center justify-center rounded-sm text-[11px] font-bold ${STATUS_CLASS[o.value]}`}
                >
                  {STATUS_LABEL[o.value]}
                </span>
                {o.name}
              </button>
            ))}
            {/* 시수(배수)·메모 — 현재 상태와 함께 저장. 상태 없으면 비활성(단독 저장 불가). */}
            <div className="border-line mt-0.5 flex w-40 flex-col gap-1 border-t pt-1">
              {/* 시수·메모는 같은 폼(플레이스홀더 인풋·동일 폭) — 라벨을 왼쪽에 두면 두 칸이 좌우로 어긋난다. */}
              <input
                type="text"
                inputMode="decimal"
                value={unitsDraft}
                onChange={(e) => {
                  setUnitsDraft(e.target.value);
                  setUnitsError(false);
                }}
                placeholder="시수(기본 1)"
                aria-label="시수"
                title="정규 수업 1회 = 1. 보강 연장 1.5·2, 부분 출석 0.5 등"
                className={`bg-bg-soft text-foreground placeholder:text-text-faint w-full rounded-md border px-2 py-1 text-xs focus:outline-none ${
                  unitsError ? "border-danger" : "border-line"
                }`}
              />
              {unitsError ? (
                <p className="text-danger text-[10px] leading-tight">숫자(소수 한 자리)만 — 예: 1, 1.5, 2</p>
              ) : null}
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="메모(사유)"
                aria-label="메모(사유)"
                className="border-line bg-bg-soft text-foreground placeholder:text-text-faint w-full rounded-md border px-2 py-1 text-xs focus:outline-none"
              />
              <button
                type="button"
                onClick={() => apply(status, draft, unitsDraft)}
                disabled={!status}
                className="bg-foreground text-background rounded-md px-2 py-1 text-xs font-medium transition disabled:opacity-40"
                title={status ? undefined : "상태를 먼저 선택하세요"}
              >
                저장
              </button>
            </div>
            {status ? (
              <button
                type="button"
                onClick={() => apply(null)}
                className="text-text-dim hover:bg-bg-soft rounded-md border-t px-2 py-1 text-left text-xs"
              >
                지우기
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </>
  );
}
