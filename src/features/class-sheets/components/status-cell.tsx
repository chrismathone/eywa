"use client";

// 출석 체크 + 상태 셀.
// 출석(비파괴 계약 §E): 기록 없음 → 체크(present 생성)만 가능. present 재클릭 = no-op.
// absent/late 등 다른 상태는 배지 표시만 — 변경·삭제는 /attendance에서(툴팁 안내).
// 상태(마크): '완/결석/안침' 칩 제안 + 자유 입력(enum 아님 — 운영 어휘 진화 허용). LWW.
import { useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { EyIcon } from "@/components/icons/eywa-icons";

const ATT_LABEL: Record<string, string> = {
  present: "출석",
  absent: "결석",
  late: "지각",
  excused: "공결",
  makeup: "보강",
  early_leave: "조퇴",
};

export function AttendanceCheck({
  status,
  canMark,
  onMark,
}: {
  status: string | null;
  canMark: boolean;
  onMark: () => void;
}) {
  if (status === null) {
    return (
      <button
        type="button"
        aria-label="출석 체크"
        disabled={!canMark}
        title={canMark ? "출석으로 기록" : "출석 입력 권한이 없거나 수정 기간이 지났습니다"}
        className="border-line hover:border-primary inline-flex size-5 cursor-pointer items-center justify-center rounded-md border disabled:cursor-not-allowed disabled:opacity-40"
        onClick={onMark}
      >
        <span className="sr-only">출석 체크</span>
      </button>
    );
  }
  if (status === "present") {
    return (
      <span
        className="bg-primary/10 text-primary inline-flex size-5 items-center justify-center rounded-md"
        title="출석 — 수정·삭제는 출석부에서"
      >
        <EyIcon name="check" size={12} />
      </span>
    );
  }
  return (
    <span
      className="bg-bg-soft text-text-dim inline-flex items-center rounded-md px-1 py-0.5 text-[10px] whitespace-nowrap"
      title="출석부에서 수정"
    >
      {ATT_LABEL[status] ?? status}
    </span>
  );
}

const STATUS_CHIPS = ["완", "결석", "안침"] as const;

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
  if (!canEdit) {
    return <span className="text-text-dim text-[11px]">{value ?? ""}</span>;
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
        className={`w-full cursor-pointer rounded-lg border px-1.5 py-1 text-left text-[11px] ${
          value ? "border-line text-foreground" : "border-line text-text-faint border-dashed"
        }`}
        aria-label="상태"
      >
        {value ?? "—"}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card w-[150px] rounded-lg border p-1.5 text-[11px] outline-none">
            <div className="flex flex-wrap gap-1">
              {STATUS_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={`cursor-pointer rounded-full border px-2 py-0.5 text-[11px] ${
                    value === chip
                      ? "border-foreground bg-foreground text-background"
                      : "border-line text-text-dim"
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
              className="border-line mt-1.5 w-full rounded-lg border bg-transparent px-1.5 py-1 text-[11px] outline-none"
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
              className="text-text-faint hover:text-danger mt-1 cursor-pointer text-[10px]"
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
