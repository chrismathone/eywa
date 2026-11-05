/**
 * 읽기 권한 화면 공통 규칙 — 원장 2026-11-05(회의록이 '읽기'인데 '+ 새 회의록'이 떠서, 양식을 다 쓴 뒤에야
 * "회의록 권한이 없습니다"가 떴다. *"읽기 권한인데 쓸 수 있는것처럼 오해 불러오지 않도록 권한 전체 손봐야할듯"*):
 *
 *  1. 작성·수정·삭제·보내기 같은 **쓰기 단추는 그리지 않는다**(비활성으로 남겨 두지 않는다).
 *  2. 입력칸(글상자·선택·날짜·체크)은 **비활성** + placeholder에 이 안내.
 *     값이 이미 차 있어 placeholder가 안 보이는 칸이면 칸 위·아래에 `writeLockedNote` 한 줄.
 *
 * 🔴 판정은 **서버 게이트와 같은 함수**(`canWriteTenant`·`canManageTenant`·각 기능의 gate)로 page.tsx(서버)에서
 *    계산해 prop으로 내린다. 화면만 다른 키·다른 함수를 보면 "보이는데 저장이 안 됨"이 다시 생긴다.
 */
import { MENU_LABEL, type MenuKey } from "@/lib/permissions";

/** 비활성 입력칸의 placeholder — 예: "회의록 작성 권한이 필요합니다". 메뉴를 모르면 "작성 권한이 필요합니다". */
export function writeLockedPlaceholder(menu?: MenuKey): string {
  return menu ? `${MENU_LABEL[menu]} 작성 권한이 필요합니다` : "작성 권한이 필요합니다";
}

/** 값이 차 있는 칸 등 placeholder로 알릴 수 없는 자리의 안내 한 줄. */
export function writeLockedNote(menu?: MenuKey): string {
  return menu
    ? `읽기 권한입니다. 고치려면 ${MENU_LABEL[menu]} 작성 권한이 필요합니다.`
    : "읽기 권한입니다. 고치려면 작성 권한이 필요합니다.";
}
