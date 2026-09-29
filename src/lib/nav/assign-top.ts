/**
 * **최상위 문서**를 다른 주소로 연다 — 창(iframe) 안에서 눌러도 창이 아니라 화면 전체가 바뀐다.
 *
 * 원장 2026-09-29: 강사뷰(창 안에 떠 있던 원스크린)에서 '열람 종료'를 누르니 관리자뷰 대시보드가 **그 창 안에** 떴다
 * ("열람 종료로 관리자뷰 돌아오면 대시보드가 창으로 나오는데"). 뷰 전환(강사뷰 ↔ 관리자뷰 · 다른 강사 보기)은 셸 전체가
 * 바뀌는 이동이라 `window.location`이 아니라 `window.top.location`이어야 한다([[#86]] 최상위 프레임 이동).
 * 창은 같은 출처(same-origin)라 top 접근이 되지만, 막히면(예외) 제 문서라도 옮긴다.
 */
export function assignTop(dest: string): void {
  try {
    if (window.top && window.top !== window.self) {
      window.top.location.assign(dest);
      return;
    }
  } catch {
    // cross-origin 등 — 아래 폴백
  }
  window.location.assign(dest);
}
