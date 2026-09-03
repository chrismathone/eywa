"use client";
/**
 * '출결 모드'의 **입력 시트** — 학생 칩을 누르면 뜨는 큰 버튼 3개(출석·지각·결석) + 사유 패널.
 *
 * 원장 2026-08-20: *"터치 몇번으로 출결 처리하게"* → 정정 *"3번이 지각으로 하고, 2번이 결석으로 해"*.
 * 실데이터가 그 정정과 같다(최근 1년 결석 974건 vs 지각 29건 = 33배). 터치 수를 계약으로 못박는다:
 *   · 출석 = 칩 → 출석 (**2터치**, 즉시 저장하고 닫는다)
 *   · 결석 = 칩 → 결석 (**2터치**, 그 자리에서 저장한다. 시트는 사유 칩만 남기고 열린 채 — 사유는 선택)
 *   · 결석 + 사유 = 3터치 (사유 칩은 **메모만** 갱신한다 — 상태·시수를 다시 보내면 방금 저장한 값을 덮는다)
 *   · 지각 = 칩 → 지각 → 저장 (**3터치**) · 사유까지 4터치
 *
 * 🔴 **결석은 사유를 고르기 전에 저장된다.** 사유 선택을 저장 앞에 두면 사유를 안 고른 결석이 아예
 *    안 찍힌다(3터치 고정 + 조용한 미기록). 아무것도 안 누르고 닫아도 결석은 남아 있어야 한다.
 * 🔴 **지각만 확인 단계를 둔다** — 메모에 시각이 들어가기 때문이다. 잘못된 등원 시각이 조용히 저장되면
 *    나중에 아무도 되짚지 못한다(결석은 상태 자체가 사실이라 확인할 것이 없다).
 * 🔴 색·라벨은 [`status-color.ts`](../../status-color.ts) 단일 소스(ATT_SOFT/ATT_SOLID)를 그대로 쓴다 —
 *    화면 파일에 상태 색 맵을 새로 만들지 않는다(팔레트 v4 의미색 캐논).
 * ⚠️ 폰은 바텀시트, 넓은 화면은 가운데 다이얼로그다(`sm:` 한 벌). 앵커 팝오버로 만들면 사유 칩 9개가
 *    카드 오른쪽 끝에서 잘린다 — 두 화면에서 같은 마크업이 서게 CSS로만 갈랐다.
 * ⚠️ 이 컴포넌트는 **탭한 뒤에만** 마운트된다 — 안에서 현재 시각을 읽어도 SSR과 갈리지 않는다([[#108]]).
 */
import { useEffect, useState } from "react";
import { ATT_SOFT, ATT_SOFT_BORDER, ATT_SOLID } from "@/features/attendance/status-color";
import { noteOnStatusChange, type QuickMarkStatus } from "../board";
import { buildLateNote, lateArrivalTime, parseLateNote } from "../late-note";
import { AbsentPanel, LatePanel } from "./quick-reason-panels";

/** `note`를 안 넘기면 **기존 메모 유지**(서버 계약 그대로) — null은 "비운다"는 뜻이다. */
export type QuickSaveInput = { status: QuickMarkStatus; note?: string | null };

const MARKS: { status: QuickMarkStatus; label: string }[] = [
  { status: "present", label: "출석" },
  { status: "late", label: "지각" },
  { status: "absent", label: "결석" },
];

export function QuickMarkSheet({
  studentName,
  schoolGrade,
  className,
  status,
  note,
  error,
  onSave,
  onSaveNote,
  onClose,
}: {
  studentName: string;
  schoolGrade: string | null;
  className: string;
  /** 지금 화면이 믿는 상태(낙관 반영 포함) — 초기 패널·선택 표시의 근거. */
  status: string | null;
  note: string | null;
  /** 서버 거절 사유(한글) — 시트가 열려 있는 동안은 여기에도 적는다(조용한 실패 금지). */
  error: string | null;
  onSave: (input: QuickSaveInput) => void;
  /** 메모만 갱신(`noteOnly`) — 이미 저장된 결석에 사유를 덧붙이는 단 하나의 경로. */
  onSaveNote: (note: string) => void;
  onClose: () => void;
}) {
  const isLate = status === "late";
  const isAbsent = status === "absent" || status === "excused";
  const parsed = parseLateNote(note);
  const [mode, setMode] = useState<"root" | "late" | "absent">(
    isLate ? "late" : isAbsent ? "absent" : "root",
  );
  // 지각 초안 — 저장 전 값이다. 이미 지각인 칸을 열었으면 **저장된 등원 시각**에서 출발한다
  // (다시 열었다는 이유로 17:05가 지금 시각으로 조용히 바뀌면 그건 사실이 아닌 기록이다).
  const [lateTime, setLateTime] = useState(() =>
    isLate ? (parsed.time ?? lateArrivalTime()) : lateArrivalTime(),
  );
  const [lateReason, setLateReason] = useState<string | null>(isLate ? parsed.reason : null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function choose(next: QuickMarkStatus) {
    if (next === "late") {
      setMode("late"); // 확인 단계만 연다 — 저장은 '지각 저장'을 눌러야 나간다(3터치)
      return;
    }
    // 출석·결석은 **누르는 즉시 저장**한다. 상태가 바뀌면 그 상태의 사유 메모는 사실이 아니므로
    // `noteOnStatusChange`가 비울지 둘지를 정한다(출석·보강 칸의 남의 메모는 건드리지 않는다).
    onSave({ status: next, note: noteOnStatusChange(status, next) });
    if (next === "absent") {
      setMode("absent"); // 사유는 **선택** — 안 고르고 닫아도 결석은 이미 저장돼 있다
      return;
    }
    onClose();
  }

  const lateNote = buildLateNote(lateTime, 0, lateReason);
  return (
    <>
      {/* 라벨을 머리의 '닫기'와 다르게 둔다 — 같은 이름의 버튼이 둘이면 화면 낭독기에서 구분되지 않는다. */}
      <button
        type="button"
        aria-label="배경을 눌러 닫기"
        onClick={onClose}
        className="fixed inset-0 z-40 cursor-default bg-black/30"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${studentName} 출결 입력`}
        className="bg-card fixed inset-x-0 bottom-0 z-50 max-h-[85vh] w-full overflow-y-auto rounded-t-2xl px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-[0_-8px_32px_rgba(0,0,0,0.18)] sm:inset-0 sm:m-auto sm:h-fit sm:max-w-md sm:rounded-2xl sm:pb-4"
      >
        <header className="mb-3 flex items-start gap-2">
          <div className="min-w-0">
            <p className="text-foreground truncate text-lg font-bold">
              {studentName}
              {schoolGrade ? (
                <span className="text-text-faint ml-1.5 text-sm font-normal">{schoolGrade}</span>
              ) : null}
            </p>
            <p className="text-text-dim truncate text-sm">{className}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-text-dim hover:bg-bg-soft ml-auto min-h-11 shrink-0 rounded-xl px-3 text-base font-bold"
          >
            닫기
          </button>
        </header>

        <div className="mb-3 flex gap-2">
          {MARKS.map((m) => {
            const on = m.status === "absent" ? isAbsent : status === m.status;
            return (
              <button
                key={m.status}
                type="button"
                onClick={() => choose(m.status)}
                aria-pressed={on}
                className={`min-h-14 flex-1 rounded-2xl text-lg font-bold transition ${
                  on ? ATT_SOLID[m.status] : `${ATT_SOFT[m.status]} border ${ATT_SOFT_BORDER[m.status]}`
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {mode === "late" ? (
          <LatePanel
            time={lateTime}
            reason={lateReason}
            note={lateNote}
            onShift={(delta) => setLateTime(lateArrivalTime(lateTime, delta))}
            onTime={(hhmm) => setLateTime(lateArrivalTime(hhmm, 0))}
            onReason={setLateReason}
            onSubmit={() => {
              onSave({ status: "late", note: lateNote });
              onClose();
            }}
          />
        ) : /* 🔴 결석 패널은 **실제로 결석이 기록됐을 때만** 그린다 — 서버가 거절해 낙관 반영이
               되돌아갔는데도 "결석으로 기록했습니다"가 남아 있으면 화면이 거짓말을 하고, 그 상태에서
               사유 칩을 누르면 `noteOnly`가 "기록이 없어 메모만 남길 수 없습니다"로 또 거절된다. */
        mode === "absent" && isAbsent ? (
          <>
            <p className="text-text-dim mb-2 text-sm">
              <span className="text-danger font-bold">결석으로 기록했습니다</span> · 사유 추가(선택)
            </p>
            <AbsentPanel
              reason={note?.trim() || null}
              onPick={(reason) => {
                onSaveNote(reason);
                onClose();
              }}
            />
          </>
        ) : null}

        {error ? <p className="text-danger mt-3 text-sm font-medium">{error}</p> : null}
      </div>
    </>
  );
}
