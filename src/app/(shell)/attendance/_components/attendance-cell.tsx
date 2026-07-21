"use client";

import { useState, useTransition } from "react";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import type { AttendanceStatus } from "@/features/attendance/server/queries";
import { parseSessionUnits } from "@/features/attendance/session-units";
import { STATUS_TEXT, STATUS_TONE, cellDisplay } from "@/features/attendance/cell-display";

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
 * 표기는 숫자 + 배경색(출석·지각·조퇴·보강 = 시수, 결석 = 0) — 규칙은 cell-display.ts 단일 소스.
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
  derived,
}: {
  studentId: string;
  classId: string;
  sessionDate: string;
  initialStatus: AttendanceStatus | null;
  note?: string | null;
  initialUnits?: number | null;
  /** 그 학생이 그 요일에 등원하는지 — 기록 없는 칸의 하이라이트. */
  attendDay?: boolean;
  /** 주말·공휴일 등 수업이 없는 날(회색). */
  muted?: boolean;
  /** 수기 기록이 아니라 수업보고서에서 파생한 값 — 툴팁에 출처 표시(derive-from-reports.ts). */
  derived?: boolean;
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

  const display = cellDisplay(status, units, { attendDay, muted });
  // 파생 칸은 **사람이 찍은 게 아니라 수업보고서에서 나온 값**이다 — 툴팁에 출처를 밝힌다(화면이 사실과
  // 다른 말을 하지 않도록). 한 번 수기로 덮으면 `derived`가 꺼져 이 표시도 사라진다.
  const fromReport = derived && status === initialStatus;
  const titleText =
    [
      status ? STATUS_TEXT[status] : null,
      fromReport ? "수업보고서 자동 판정 (클릭해 직접 수정)" : null,
      noteVal || null,
    ]
      .filter(Boolean)
      .join(" · ") || undefined;

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
          setUnitsDraft(units !== null && units !== 1 ? String(units) : "");
          setUnitsError(false);
          setOpen(true);
        }}
        title={titleText}
        // 셀 전체를 채우는 배경색이 곧 상태 표시 — 부모 td는 relative + p-0.
        // ⚠️ 고정 크기 칩에 배경을 주면 셀을 못 채운다(gotcha #66).
        className={`absolute inset-0 flex items-center justify-center text-[11px] font-bold transition ${display.className} ${
          status ? "" : "hover:bg-bg-soft"
        }`}
        aria-label={[
          `출결 상태 변경 (현재: ${status ? STATUS_TEXT[status] : "미기록"})`,
          noteVal ? `메모: ${noteVal}` : null,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {display.text}
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
                className={`flex items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-xs transition hover:bg-bg-soft ${
                  status === o.value ? "font-bold" : ""
                }`}
              >
                {o.name}
                {/* 표기가 숫자·배경색이라 좌측 O/X 글자 대신 우측 색칩으로 "어떤 색이 칠해지는지"를 보여준다.
                    셀과 같은 STATUS_TONE을 써서 칩 색이 실제 셀과 어긋날 수 없다. */}
                <span className={`border-line size-4 shrink-0 rounded-sm border ${STATUS_TONE[o.value]}`} aria-hidden />
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
