import type { ReactNode } from "react";

/**
 * 폼 저장 액션 바 — **모든 입력 폼에서 동일한 위치**(하단 우측 고정)로 통일한다.
 * `sticky bottom-0`이라 스크롤해도 창(또는 페이지) 하단에 항상 붙어 보인다 → 긴 폼에서 저장 버튼을
 * 찾아 스크롤할 필요가 없고, 창마다 위치가 제각각이던 것도 해소. 창(iframe)·전체화면·강사 미니셸
 * 어디서든 같은 자리.
 *
 * 사용: 폼의 마지막 자식으로 `<FormActionBar><Button type="submit">저장</Button></FormActionBar>`.
 * 버튼은 우측 정렬(주 액션이 가장 오른쪽). 배경은 **완전 불투명(bg-background)** — 반투명+blur는
 * 스크롤되는 본문(칩·카드)이 바 뒤로 비쳐 지저분하다(2026-07-10 사용자 피드백). 페이지 배경과 같은
 * 색이라 평소엔 안 보이고, 스크롤 중엔 상단 헤어라인+그림자만 바를 표시한다.
 *
 * ⚠️ **바가 진짜 뷰포트 바닥에 밀착하려면 스크롤 컨테이너(main)에 `padding-bottom`이 없어야 한다**(2026-07-10):
 * `sticky bottom-0`은 스크롤포트의 **콘텐츠 박스 하단**에 붙는다. main이 `pb`를 가지면 바가 그만큼(≈20px)
 * 떠 보이고, 그 틈으로 본문이 지나가며, 좌측 사이드바 푸터 구분선과 높이도 어긋난다. → shell `main`을
 * `pt-4 lg:pt-5`(하단 패딩 제거)로 바꿔 바를 진짜 바닥에 밀착시켰다(고정 위치=자연 끝 위치라 스크롤 점프도
 * 없음, top border가 사이드바 푸터 구분선과 정렬). 하단 여백은 스크롤되는 폼 본문엔 불필요.
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
      className={`border-line bg-background sticky bottom-0 z-20 flex items-center justify-end gap-2 border-t px-0.5 py-3 shadow-[0_-4px_10px_-6px_rgba(26,31,28,0.12)] ${className}`}
    >
      {children}
    </div>
  );
}
