"use client";

// 출석 체크 + 상태 셀.
// 출석(0168a): 기록 없음 → 체크(present 생성) / present 재클릭 → **취소**(plain present만 — 결석·지각이나
// 출석부에서 사유·시수가 붙은 기록은 배지 표시만, 변경은 /attendance에서). 원장 지시 2026-07-31.
// 상태(마크): '완/결석/안침' 칩 제안 + 자유 입력(enum 아님 — 운영 어휘 진화 허용). LWW.
//
// 대비(가독성): 원본 시트가 색으로 하던 일을 그대로 한다 — 출석은 초록 솔리드(시트의 굵은 TRUE),
// 상태는 완=초록·결석=빨강·주의=앰버 소프트(#d9ead3 / #f4cccc / #fff2cc의 앱 팔레트 대응).
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { EyIcon } from "@/components/icons/eywa-icons";
import { STATUS_CHIPS } from "../lib/bulk";
import { statusTone, STATUS_TONE_CLASS } from "../lib/status-tone";

const ATT_LABEL: Record<string, string> = {
  present: "출석",
  absent: "결석",
  late: "지각",
  excused: "공결",
  makeup: "보강",
  early_leave: "조퇴",
};

/** 출석부 상태(enum) 배지 톤 — 상태 마크와 같은 색 규칙(결석=빨강·지각/보강/조퇴=앰버). */
const ATT_TONE: Record<string, string> = {
  absent: "bg-danger-soft text-danger border-danger/30",
  late: "bg-amber-soft text-amber border-amber/30",
  excused: "bg-amber-soft text-amber border-amber/30",
  makeup: "bg-amber-soft text-amber border-amber/30",
  early_leave: "bg-amber-soft text-amber border-amber/30",
};

export function AttendanceCheck({
  status,
  canMark,
  onMark,
  onClear,
}: {
  status: string | null;
  canMark: boolean;
  onMark: () => void;
  onClear: () => void;
}) {
  if (status === null) {
    return (
      <button
        type="button"
        aria-label="출석 체크"
        aria-pressed={false}
        disabled={!canMark}
        title={canMark ? "출석으로 기록" : "출석 입력 권한이 없거나 수정 기간이 지났습니다"}
        // 빈 칸도 "누를 수 있는 칸"으로 보여야 한다 — 헤어라인(9%)이 아니라 line-strong 2px.
        className="border-line-strong hover:border-green hover:bg-green-soft inline-flex size-6 cursor-pointer items-center justify-center rounded-md border-2 transition disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onMark}
      >
        <span className="sr-only">출석 체크</span>
      </button>
    );
  }
  if (status === "present") {
    // 체크된 상태 = 시트의 굵은 TRUE. 다시 누르면 취소(권한·기간이 없으면 표시만).
    const common = "bg-green inline-flex size-6 items-center justify-center rounded-md text-white";
    if (!canMark) {
      return (
        <span className={common} title="출석 — 수정·삭제는 출석부에서">
          <EyIcon name="check" size={15} />
        </span>
      );
    }
    return (
      <button
        type="button"
        aria-label="출석 취소"
        aria-pressed
        title="출석 — 다시 누르면 취소"
        className={`${common} hover:bg-danger cursor-pointer transition`}
        onClick={onClear}
      >
        <EyIcon name="check" size={15} />
      </button>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap ${
        ATT_TONE[status] ?? "bg-bg-soft text-text-dim border-line-strong"
      }`}
      title="출석부에서 수정"
    >
      {ATT_LABEL[status] ?? status}
    </span>
  );
}

export function StatusCell({
  value,
  canEdit,
  onChange,
}: {
  value: string | null;
  canEdit: boolean;
  onChange: (status: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [free, setFree] = useState("");
  const tone = statusTone(value);
  if (!canEdit) {
    return value ? (
      <span className={`inline-block truncate rounded-lg border px-1.5 py-0.5 text-[12px] ${STATUS_TONE_CLASS[tone]}`}>
        {value}
      </span>
    ) : (
      <span className="text-text-faint text-[12px]">—</span>
    );
  }
  return (
    // base-ui Popover(앱 표준 11곳) — 바깥 클릭·ESC·포커스 이탈 닫기가 내장이고(수동 document 리스너
    // 금지), Portal이라 DragScrollArea의 이중 overflow에 잘리지 않고 아래 공간이 부족하면 위로 뒤집힌다.
    // 옛 구현은 td 안 absolute라 ① 바깥을 눌러도 안 닫히고 ② 스크롤 영역 끝에서 잘렸다(원장 제보 07-29).
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setFree(""); // 미저장 자유입력이 남아 다음에 열 때 되살아나면 저장된 값으로 오인한다
      }}
    >
      <Popover.Trigger
        className={`w-full cursor-pointer truncate rounded-lg border px-1.5 py-1 text-left text-[12px] ${
          value ? STATUS_TONE_CLASS[tone] : "border-line-strong text-text-faint border-dashed"
        }`}
        aria-label="상태"
        title={value ?? "상태 입력"}
      >
        {value ?? "—"}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line-strong shadow-card w-[170px] rounded-lg border p-2 text-[12px] outline-none">
            <div className="flex flex-wrap gap-1">
              {STATUS_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={`cursor-pointer rounded-full border px-2 py-0.5 text-[12px] ${
                    value === chip
                      ? "border-foreground bg-foreground text-background font-bold"
                      : `${STATUS_TONE_CLASS[statusTone(chip)]} hover:border-foreground`
                  }`}
                  onClick={() => {
                    onChange(value === chip ? null : chip);
                    setOpen(false);
                  }}
                >
                  {chip}
                </button>
              ))}
            </div>
            <input
              className="border-line-strong text-foreground focus:border-primary mt-1.5 w-full rounded-lg border bg-transparent px-1.5 py-1 text-[12px] outline-none"
              placeholder="직접 입력"
              value={free}
              aria-label="상태 직접 입력"
              onChange={(e) => setFree(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  onChange(free.trim() === "" ? null : free.trim());
                  setFree("");
                  setOpen(false);
                }
              }}
            />
            <button
              type="button"
              className="text-text-dim hover:text-danger mt-1.5 cursor-pointer text-[11px]"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              지우기
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
