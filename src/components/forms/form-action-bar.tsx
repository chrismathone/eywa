import type { ReactNode } from "react";

/**
 * 폼 저장 액션 바 — **모든 입력 폼에서 동일한 위치**(하단 우측 고정)로 통일한다.
 * `sticky bottom-0`이라 스크롤해도 창(또는 페이지) 하단에 항상 붙어 보인다 → 긴 폼에서 저장 버튼을
 * 찾아 스크롤할 필요가 없고, 창마다 위치가 제각각이던 것도 해소. 창(iframe)·전체화면·강사 미니셸
 * 어디서든 같은 자리.
 *
 * 사용: 폼의 마지막 자식으로 `<FormActionBar><Button type="submit">저장</Button></FormActionBar>`.
 * 버튼은 우측 정렬(주 액션이 가장 오른쪽). 배경 반투명+blur로 스크롤되는 본문이 비쳐도 깔끔.
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
      className={`border-line bg-background/85 supports-[backdrop-filter]:bg-background/70 sticky bottom-0 z-20 -mb-1 flex items-center justify-end gap-2 border-t px-0.5 py-3 backdrop-blur ${className}`}
    >
      {children}
    </div>
  );
}
