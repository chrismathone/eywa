"use client";

import { assignTop } from "@/lib/nav/assign-top";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { switchToTeacherView } from "@/features/shell/view-actions";

// 전환이 거절·실패했을 때의 안내 — 버튼이 잠깐 흐려졌다 풀리고 끝나면 고장인지 권한인지 알 길이 없다(2026-09-11).
// 🔴 거절 문구에 원인을 적지 말 것 — 액션의 null은 세션 없음·자격 없음·조회 실패를 가르지 않는다(리뷰 2026-09-11).
//    거절 뒤엔 화면이 스스로 다시 그려져(router.refresh) 항목이 지금 자격대로 남거나 사라진다 — 그래서 "새로고침하라"고
//    시키지 않는다(이미 했고, 자격이 없으면 누를 항목도 없다 — 재리뷰 2026-09-11).
const REFUSED = "지금은 강사뷰로 전환할 수 없습니다 — 화면을 다시 불러왔으니 항목이 남아 있으면 다시 눌러 주세요.";
const FAILED = "강사뷰로 전환하지 못했습니다. 잠시 후 다시 눌러 주세요.";

/**
 * 관리자 → **내** 강사뷰(겸직, 쓰기 가능). 사이드바 '강사뷰 전환' 드롭다운의 맨 위 '나' 항목이 부른다
 * (원장 2026-09-29 *"내 학생이 있는거랑 없는거랑 전부 통일. 내가 전환 가능한경우 내가 가장 상단에"*).
 * 노출 여부(관리자 계열 + 담당 반 또는 오늘 위임받은 반)는 부모가 canUseTeacherView로 판정하고, 전환 액션도
 * **같은 함수**로 다시 판정한다. 그래도 거절되면(그 사이 위임이 끝남·세션 만료·조회 실패 등) 조용히 멈추지 않고
 * 알린다 — 액션이 원인을 가르지 않으므로 원인은 단정하지 않는다.
 */
export function useOwnTeacherViewSwitch() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = () =>
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
        // 액션이 착지 경로를 반환 → window.location으로 **풀 문서 네비**(soft nav이 아님).
        // 이래야 라우터 캐시가 강사 미니셸로 오염되지 않아 뒤로가기 시 깨진 렌더가 나지 않는다(view-actions 주석 참조).
        assignTop(dest);
        return;
      }
      toast.error(REFUSED);
      // 사이드바를 다시 그려 더는 설 수 없는 항목을 거둔다(노출도 같은 판정이라 이번엔 안 선다).
      router.refresh();
    });
  return { pending, go };
}
