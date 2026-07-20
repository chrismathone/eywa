"use client";

import { useTransition } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { switchToTeacherView } from "@/features/shell/view-actions";

// 펼침/접힘 모핑 이징 — 사이드바 레일과 동일 톤.
const EASE = "ease-[cubic-bezier(0.22,0.61,0.36,1)]";

/**
 * 관리자 → 강사뷰 (사이드바 하단, 겸직일 때만 노출). 레일 톤(아이콘+라벨, 접힘 시 아이콘+우측 툴팁)에 맞춘다.
 * 노출 여부(겸직=관리자 계열 + 담당 반 보유)는 부모가 canUseTeacherView로 판정해 렌더한다.
 */
export function TeacherViewToggle({ expanded, motion }: { expanded: boolean; motion: boolean }) {
  const [pending, start] = useTransition();
  const btn = (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          // 액션이 착지 경로("/onescreen")를 반환 → window.location으로 **풀 문서 네비**(soft nav이 아님).
          // 이래야 라우터 캐시가 강사 미니셸로 오염되지 않아 뒤로가기 시 깨진 렌더가 나지 않는다(view-actions 주석 참조).
          const dest = await switchToTeacherView();
          if (dest) window.location.assign(dest);
        })
      }
      aria-label="강사뷰로 전환"
      className="group relative flex h-9 w-full items-center gap-2.5 pl-[17px] focus:outline-none disabled:opacity-50"
    >
      {/* 레일 hover 하이라이트 — ExternalRailItem과 동일(접힘 8 / 펼침 4 인셋). */}
      <span
        aria-hidden="true"
        style={{ left: expanded ? 4 : 8, right: expanded ? 4 : 8 }}
        className={`bg-sidebar-accent pointer-events-none absolute inset-y-0 z-0 rounded-lg opacity-0 group-hover:opacity-100 ${
          motion ? `transition-[left,right,opacity] duration-200 ${EASE}` : ""
        }`}
      />
      <EyIcon
        name="screen"
        size={18}
        strokeWidth={1.8}
        className={`text-text-dim group-hover:text-foreground relative z-10 shrink-0 ${
          motion ? "transition-colors duration-200" : ""
        }`}
      />
      <span
        className={`text-text-dim group-hover:text-foreground relative z-10 overflow-hidden text-[13px] font-medium whitespace-nowrap ${
          expanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"
        } ${motion ? `transition-[max-width,opacity,color] duration-200 ${EASE}` : ""}`}
      >
        강사뷰로 전환
      </span>
    </button>
  );

  if (expanded) return btn;
  return (
    <Tooltip>
      <TooltipTrigger render={btn} />
      <TooltipContent side="right">강사뷰로 전환</TooltipContent>
    </Tooltip>
  );
}
