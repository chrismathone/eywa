import type { ReactNode } from "react";

/**
 * 폼 저장 액션 바 — **모든 입력 폼에서 동일한 위치**(하단 우측 고정)로 통일한다.
 * `sticky bottom-0`이라 스크롤해도 창(또는 페이지) 하단에 항상 붙어 보인다 → 긴 폼에서 저장 버튼을
 * 찾아 스크롤할 필요가 없고, 창마다 위치가 제각각이던 것도 해소. 창(iframe)·전체화면·강사 미니셸
 * 어디서든 같은 자리.
 *
 * 사용: 폼의 마지막 자식으로 `<FormActionBar><Button type="submit">저장</Button></FormActionBar>`.
 * 버튼은 우측 정렬(주 액션이 가장 오른쪽). 배경은 **완전 불투명(bg-bg-canvas = 화면 바탕)** — 반투명+blur는
 * 스크롤되는 본문(칩·카드)이 바 뒤로 비쳐 지저분하다(2026-07-10 사용자 피드백). 페이지 배경과 같은
 * 색이라 평소엔 안 보이고, 스크롤 중엔 상단 헤어라인+그림자만 바를 표시한다.
 *
 * ⚠️ **바가 진짜 뷰포트 바닥에 밀착하려면 스크롤 컨테이너(main)에 `padding-bottom`이 없어야 한다**(2026-07-10):
 * `sticky bottom-0`은 스크롤포트의 **콘텐츠 박스 하단**에 붙는다. main이 `pb`를 가지면 바가 그만큼
 * 떠 보이고, 그 틈으로 본문이 지나간다. 2026-08-14에 셸 main 3곳이 "스크롤 끝 빠듯" 여백(pb-8 lg:pb-10)을
 * 되찾으면서 이 전제가 깨져 모든 저장 바가 다시 떴다(원장 제보 2026-08-17, 셔틀 편집기) → 지금은
 * **루트에 `sticky-save-bar` 마커**를 달고 globals.css의 unlayered `main:has(.sticky-save-bar)` 규칙이
 * 저장 바 있는 화면에서만 main의 pb를 0으로 되돌린다(바 없는 화면은 08-14 여백 유지). [[#110]]
 * 수제 하단 고정 저장 바를 만들 때도 이 마커를 반드시 붙일 것.
 * ⚠️ 과거 실패: 음수 margin은 sticky 클램프를 못 옮기고, `after:` 밴드는 절대배치라도 스크롤 오버플로를
 * 늘려 **오히려 맨아래 스크롤 점프를 유발**했다 — 둘 다 쓰지 말 것. 정답은 main의 pb 제거 하나.
 */
export function FormActionBar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`sticky-save-bar border-line bg-bg-canvas sticky bottom-0 z-20 flex items-center justify-end gap-2 border-t px-0.5 py-3 shadow-[0_-4px_10px_-6px_rgba(29,29,31,0.12)] ${className}`}
    >
      {children}
    </div>
  );
}
