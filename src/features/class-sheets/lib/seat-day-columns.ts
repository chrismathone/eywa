/**
 * 305·JJ실 **하루 표**의 가로 치수 단일 소스 — colgroup·표 최소폭이 여기 하나를 본다.
 *
 * 오늘 면(today-columns)과 달리 이 표는 **위층 카드 레일이 없다**(교시 블록이 세로로 쌓인 독립 표).
 * 그래서 "합 = 교시 폭" 항등식은 없고, 대신 지켜야 할 것이 둘이다:
 *  1. **이름 칸이 [이름 + 반 배지] 한 줄을 담을 것.** 동명이인 접미사(`이서온A`)로 이름이 한 글자만
 *     길어져도 배지가 둘째 줄로 꺾이면 그 행만 키가 커져 옆 열 입력 상자들이 위아래로 어긋난다
 *     (원장 2026-08-19 *"이름에 문자가 붙는 학생 때문에 열이 흐트러짐"* — 실측은 seat-day-table.tsx 각주).
 *  2. **앞 4열(이름·출결·유닛·태도)은 폼과 무관하게 같을 것.** 교시마다 폼이 달라도(JJ 전용 칸) 거기까지는
 *     같은 x에 오고, 달라지는 건 자유 입력 열부터다 — 그 사실은 머리 라벨과 블록 헤더 칩이 보여 준다.
 *
 * ⚠️ 출결·유닛·태도 폭은 주간 시트·오늘 면과 **같은 상수**(TODAY_BASE_COLS) — 한쪽만 고치면 세 화면이 갈린다.
 * ⚠️ 특이사항은 잔여(`<col>` 무지정)라 **폭을 여기서 정하지 않는다.** 대신 좁은 창에서 0으로 짜부라지지
 *    않게 표 전체 `min-width`에 최소치를 넣는다(넘치면 DragScrollArea가 가로로 받는다).
 */
import { rosterTextCols, type RosterForm } from "./roster-form";
import { TODAY_BASE_COLS } from "./today-columns";

/** 이름 몫 — 13px 굵게 실측: 한글 5자 ≈ 65 + 동명이인 접미 1자(A~D) ≈ 9 = 74 → 76. */
export const SEAT_NAME_TEXT_W = 76;

/** 반 배지 몫 — 10px 굵게 + px-1.5. 실측: `초등 브릿지 A` ≈ 76, `중1 정규 A` ≈ 62. 넘치면 … + 툴팁. */
export const SEAT_BADGE_W = 76;

/** 이름↔배지 사이(gap-1). */
export const SEAT_NAME_GAP = 4;

/** 이름 칸 오른쪽 여백(td `pr-1`) — 열 폭에 포함돼야 배지가 옆 열 경계에 닿지 않는다. */
export const SEAT_NAME_PAD = 4;

/** 이름 열 = 이름 + 사이 + 배지 + 오른쪽 여백. 이 합이 곧 "한 줄에 들어간다"는 약속이다. */
export const SEAT_NAME_W = SEAT_NAME_TEXT_W + SEAT_NAME_GAP + SEAT_BADGE_W + SEAT_NAME_PAD;

/** 특이사항 최소 폭 — 잔여가 이보다 좁아지면 표가 가로로 넘치고 컨테이너가 스크롤을 받는다. */
export const SEAT_NOTE_MIN_W = 180;

/** 폼과 무관한 앞 4열 [이름, 출결, 유닛, 태도] — 블록이 여러 개여도 여기까지는 같은 x. */
export function seatLeadCols(): number[] {
  return [SEAT_NAME_W, ...TODAY_BASE_COLS];
}

/** 표의 **고정 열**(특이사항 제외) = 앞 4열 + 폼별 자유 입력 열. colgroup이 이 순서 그대로 돈다. */
export function seatFixedCols(form: RosterForm): number[] {
  return [...seatLeadCols(), ...rosterTextCols(form).map((c) => c.width)];
}

/** 표 최소 폭 = 고정 열 합 + 특이사항 최소. 좁은 창에선 이 폭으로 넘쳐 가로 스크롤이 받는다. */
export function seatTableMinWidth(form: RosterForm): number {
  return seatFixedCols(form).reduce((a, b) => a + b, 0) + SEAT_NOTE_MIN_W;
}
