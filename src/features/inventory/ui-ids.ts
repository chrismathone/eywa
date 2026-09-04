/**
 * 재고관리 화면 안의 DOM id — 스탯 카드(클라)가 조치 목록(서버 `<details>`)을 열고 스크롤할 때 쓴다.
 * 순수 모듈: 서버·클라 양쪽이 읽는다("use client" 모듈의 상수를 서버가 가져오면 런타임 undefined, [[#81]]).
 */
export const ACTION_NEEDED_ID = "inventory-action-needed";
