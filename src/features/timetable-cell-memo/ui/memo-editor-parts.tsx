"use client";

import type { PointerEvent as ReactPointerEvent } from "react";
import type { SaverStatus } from "../memo-saver";
import { formatMemoStamp, type CellMemo } from "../rules";
import type { ResizeAxis } from "./use-box-resize";

const BTN = "border-line bg-card text-foreground rounded-md border px-2 py-0.5 text-xs";

/** 다른 사람이 먼저 고쳤다 — 최신을 보여 주고, 내 글은 되살릴 길을 준다(조용히 덮지 않는다). */
export function ConflictNote({
  conflict,
  onOverwrite,
  onDismiss,
}: {
  conflict: { latest: CellMemo | null; mine: string };
  onOverwrite: () => void;
  onDismiss: () => void;
}) {
  return (
    <div role="alert" className="bg-danger-soft border-line shrink-0 space-y-1 border-b px-3 py-1.5 text-xs">
      <p>
        {conflict.latest
          ? `다른 분이 먼저 고쳤습니다(${formatMemoStamp(conflict.latest.updatedAt, conflict.latest.updatedByName)}). 최신 내용을 보여 드립니다.`
          : "다른 분이 이 메모를 지웠습니다."}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {conflict.mine.trim() ? (
          <button type="button" className={BTN} onClick={onOverwrite}>
            {conflict.latest ? "내가 쓴 글로 덮어쓰기" : "내가 쓴 글 다시 넣기"}
          </button>
        ) : null}
        <button type="button" className={BTN} onClick={onDismiss}>
          확인
        </button>
      </div>
    </div>
  );
}

/** 마지막 줄 — 왼쪽 `yy.mm.dd hh:mm 이름`(저장값) · 오른쪽 저장 상태(저장 단추 대신 지금 어디까지 들어갔는지). */
export function EditorFooter({
  live,
  status,
  empty,
  saved,
  onRetry,
}: {
  live: CellMemo | undefined;
  status: SaverStatus;
  empty: boolean;
  saved: boolean;
  onRetry: () => void;
}) {
  const busy = status.kind === "pending" || status.kind === "saving";
  return (
    <div className="border-line flex shrink-0 items-center gap-2 border-t px-3 py-1 text-xs">
      <span className="num min-w-0 truncate">{live ? formatMemoStamp(live.updatedAt, live.updatedByName) : ""}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {status.kind === "error" ? (
          <>
            <span className="text-danger">{status.message}</span>
            <button type="button" className={BTN} onClick={onRetry}>
              다시 저장
            </button>
          </>
        ) : busy ? (
          empty && saved ? "비우고 닫으면 메모가 지워집니다" : "저장 중…"
        ) : saved ? (
          "저장됨"
        ) : null}
      </span>
    </div>
  );
}

/** 크기 손잡이 — 오른쪽 가장자리 · 아래 가장자리 · 오른쪽 아래 모서리(모서리만 보이는 표시). */
export function ResizeHandles({ start }: { start: (axis: ResizeAxis) => (e: ReactPointerEvent<HTMLElement>) => void }) {
  return (
    <>
      <span aria-hidden className="absolute top-0 right-0 h-full w-1.5 cursor-ew-resize" onPointerDown={start("x")} />
      <span aria-hidden className="absolute bottom-0 left-0 h-1.5 w-full cursor-ns-resize" onPointerDown={start("y")} />
      <span
        aria-hidden
        className="border-line absolute right-0.5 bottom-0.5 size-2.5 cursor-nwse-resize border-r-2 border-b-2"
        onPointerDown={start("xy")}
      />
    </>
  );
}
