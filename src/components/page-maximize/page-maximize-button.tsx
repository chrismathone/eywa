"use client";

import { Button } from "@/components/ui/button";
import { EyIcon } from "@/components/icons/aywa-icons";
import { useInFrame } from "@/components/workspace/use-in-frame";
import { usePageMaximize } from "./page-maximize-context";

/**
 * 페이지 헤더 오른쪽 끝의 **'화면 최대화'**(원장 2026-10-01 *"'화면 최대화'로 이름 변경"*) — 공용 `PageHeader`가
 * 그리므로 헤더를 쓰는 모든 메뉴에 저절로 선다(화면 파일은 아무것도 안 한다).
 *
 * 안 보이는 곳 — 판정은 여기 한 곳:
 * - 공급자가 없는 셸(창 안 · 강사·학생 미니셸 · 슈퍼관리자) · 창 모드가 켜진 지점 → `usePageMaximize()`가 `null`.
 * - 창(iframe) 안으로 풀셸이 새어 들어온 경우(드릴인으로 embed가 떨어짐) → `useInFrame()`.
 * - 데스크톱이 아닌 화면(좁은 폭·터치) → CSS `hidden desk:inline-flex`(서버 렌더부터 정해져 깜빡임이 없다).
 * 아이콘 = 플로팅 창 최대화와 같은 사각형(되돌리기는 겹친 사각형 — 창 크롬과 같은 짝).
 */
export function PageMaximizeButton() {
  const ctx = usePageMaximize();
  const inFrame = useInFrame();
  // 최대화 중엔 이 버튼이 설 자리가 없다(제목 묶음이 숨고, 출구는 '화면 원래대로' 하나) — 동작만 남은 헤더 줄에 끼지 않게.
  if (!ctx || inFrame || ctx.maximized) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-page-maximize-button=""
      onClick={() => ctx.setMaximized(true)}
      className="hidden desk:inline-flex"
    >
      <EyIcon name="square" />
      화면 최대화
    </Button>
  );
}
