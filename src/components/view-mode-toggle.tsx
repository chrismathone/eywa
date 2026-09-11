"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { switchToTeacherView } from "@/features/shell/view-actions";

// 펼침/접힘 모핑 이징 — 사이드바 레일과 동일 톤.
const EASE = "ease-[cubic-bezier(0.22,0.61,0.36,1)]";

// 전환이 거절·실패했을 때의 안내 — 버튼이 잠깐 흐려졌다 풀리고 끝나면 고장인지 권한인지 알 길이 없다(2026-09-11).
// 🔴 거절 문구에 원인을 적지 말 것 — 액션의 null은 세션 없음·자격 없음·조회 실패를 가르지 않는다(리뷰 2026-09-11).
//    거절 뒤엔 화면이 스스로 다시 그려져(router.refresh) 버튼이 지금 자격대로 남거나 사라진다 — 그래서 "새로고침하라"고
//    시키지 않는다(이미 했고, 자격이 없으면 누를 버튼도 없다 — 재리뷰 2026-09-11).
const REFUSED = "지금은 강사뷰로 전환할 수 없습니다 — 화면을 다시 불러왔으니 버튼이 남아 있으면 다시 눌러 주세요.";
const FAILED = "강사뷰로 전환하지 못했습니다. 잠시 후 다시 눌러 주세요.";

/**
 * 관리자 → 강사뷰 (사이드바 하단, 겸직일 때만 노출). 레일 톤(아이콘+라벨, 접힘 시 아이콘+우측 툴팁)에 맞춘다.
 * 노출 여부(관리자 계열 + 담당 반 또는 오늘 위임받은 반)는 부모가 canUseTeacherView로 판정해 렌더하고, 전환 액션도
 * **같은 함수**로 다시 판정한다. 그래도 거절되면(그 사이 위임이 끝남·세션 만료·조회 실패 등) 조용히 멈추지 않고
 * 알린다 — 액션이 원인을 가르지 않으므로 원인은 단정하지 않는다.
 */
export function TeacherViewToggle({ expanded, motion }: { expanded: boolean; motion: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const btn = (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          let dest: string | null = null;
          try {
            dest = await switchToTeacherView();
          } catch (e) {
            // 원문(네트워크 에러 등)은 화면에 내보내지 않는다 — 콘솔에만.
            console.error("[view-toggle] 강사뷰 전환 실패", e);
            toast.error(FAILED);
            return;
          }
          if (dest) {
            // 액션이 착지 경로("/onescreen")를 반환 → window.location으로 **풀 문서 네비**(soft nav이 아님).
            // 이래야 라우터 캐시가 강사 미니셸로 오염되지 않아 뒤로가기 시 깨진 렌더가 나지 않는다(view-actions 주석 참조).
            window.location.assign(dest);
            return;
          }
          toast.error(REFUSED);
          // 사이드바를 다시 그려 더는 설 수 없는 버튼을 거둔다(노출도 같은 판정이라 이번엔 안 선다).
          router.refresh();
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
        className={`text-text-dim group-hover:text-foreground relative z-10 overflow-hidden text-sm font-medium whitespace-nowrap ${
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
