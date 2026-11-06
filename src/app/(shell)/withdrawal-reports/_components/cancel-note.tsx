"use client";

import type { ReactNode } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * 목록 상태 칸의 '요청 취소 · 취소일 MM-DD'(children — 목록이 '·' 뒤에서만 접히게 조각으로 넘긴다) — 점선 밑줄 ·
 * 마우스를 올리거나 키보드로 초점을 주면 말풍선(취소 사유 · 취소한 사람 · 시각).
 * 원장 2026-11-06 시안 A. 글은 판정 함수(`reportProgress`)가 다 만들어 온다 — 여기선 그리기만.
 */
export function CancelNote({ children, reason, meta }: { children: ReactNode; reason: string; meta: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span tabIndex={0} />}
        className="focus-visible:outline-primary cursor-help rounded-sm underline decoration-dotted underline-offset-4 focus-visible:outline-2"
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" className="block w-max max-w-64 text-left whitespace-normal">
        <span className="block font-bold">취소 사유</span>
        <span className="block">{reason}</span>
        <span className="text-background/75 mt-0.5 block">{meta}</span>
      </TooltipContent>
    </Tooltip>
  );
}
