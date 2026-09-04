"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import type { Season } from "@/features/shuttle/types";

/**
 * 노선 편성 머리의 **텍스트 Secondary 하나** — '인쇄 ▾'(오늘 노선표 · 전체 편성표). 지시서 §10: 상시 버튼은
 * Primary('정류장 관리') + 텍스트 하나. 옛 모양 = outline 버튼 셋(오늘 노선표 인쇄·전체 편성표 인쇄·정류장 관리).
 * 학생목록 '엑셀 ▾'·회의록 '더보기 ▾'와 같은 모양(디자인 v5 17단계 2026-09-04).
 * 인쇄는 `(print)` 라우트를 브라우저 새 탭으로 연다(`window.open` — 옛 버튼과 같은 경로; 회의록 '더보기'의 `usePrintWindow`
 * 플로팅 창으로 옮기는 건 별건).
 */
export function ShuttlePrintMenu({ season }: { season: Season }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={`${CONTROL_H} ${CONTROL_LABEL} text-primary hover:bg-bg-soft inline-flex items-center gap-0.5 rounded-md px-1.5 font-medium whitespace-nowrap transition`}
          />
        }
      >
        인쇄
        {/* 아이콘은 라벨(18px)과 같은 크기(±10%). */}
        <EyIcon name="chevronDown" size={18} className="opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => window.open(`/shuttle/route?season=${season}`, "_blank")}>
          오늘 노선표
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.open(`/shuttle/route?season=${season}&d=all`, "_blank")}>
          전체 편성표
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
