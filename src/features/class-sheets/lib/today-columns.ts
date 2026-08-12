/**
 * 오늘 면(시트 모드)의 **가로 치수 단일 소스** — 위 교시 카드 레일과 아래 통합 로스터가 같은 격자를 쓴다.
 *
 * 원장 2026-08-11: *"이거 줄맞춤 해줘. 위의 수업줄이랑 하단의 학생줄이랑 다르네 열너비 같도록."*
 * 그전엔 두 곳이 **각자 폭을 정했다** — 카드는 540px 고정, 표는 `출결60+유닛46+태도80+점수54`에
 * 특이사항만 가변(남는 폭을 다 먹음). 그래서 교시 경계가 위아래로 어긋났다.
 *
 * 🔴 **둘의 폭을 한 곳에서 계산한다.** 한쪽 숫자만 고치면 다시 어긋나는데, 어긋남은 조용하다
 *    (타입도 테스트도 안 걸린다 — 눈으로 봐야 보인다). 그래서 여기에 모으고 아래 항등식을 테스트로 잠근다.
 * ⚠️ 카드 폭(540)은 **주간 시트 열 폭과 같은 수치**다(sheet-grid `COL_W`). 줄이면 계획 표의 고정 열
 *    (구분86·교재130·시간74·×26)이 남는 폭을 다 먹어 진도·과제가 슬리버로 무너진다.
 * ⚠️ **교시 사이 숨은 0이다**(원장 2026-08-11 *"카드 크기도 같으면 좋겠고 여백도 최소화하고 줄로 교시
 *    구분"*). 카드가 열 폭과 **정확히 같아야** 위아래가 한 격자로 읽히고, 사이는 여백이 아니라
 *    **세로선**이 가른다(아래 표가 이미 `border-l-line-faint`로 하던 것과 같은 방식).
 *    ⚠️ 숨을 되살릴 땐 `gap`이 아니라 **카드 안쪽 패딩**으로 — gap은 카드 왼쪽 모서리를 열 경계보다
 *    밀어내 교시가 늘수록 어긋남이 누적된다.
 */

/** 학생 이름 열 — 주간 로스터(roster-table colgroup)와 같은 수치. */
export const TODAY_NAME_W = 64;

/** 교시 그룹 안 고정 열 [출결, 유닛, 태도, 점수] — 주간 로스터와 같은 수치. */
export const TODAY_SLOT_COLS = [60, 46, 80, 54] as const;

/** 교시 사이 숨 — **0**. 경계는 여백이 아니라 세로선이 긋는다(위 주석 참조). */
export const TODAY_GUTTER = 0;

/** 교시 카드(계획) 폭 — 주간 시트 열과 동일. */
export const TODAY_PLAN_W = 540;

/** 한 교시가 차지하는 전체 폭 = 카드 + 숨. 위아래가 **같은 값**을 쓴다. */
export const TODAY_SLOT_W = TODAY_PLAN_W + TODAY_GUTTER;

const FIXED_SUM = TODAY_SLOT_COLS.reduce((a, b) => a + b, 0);

/**
 * 특이사항 열 폭 — 교시 폭에서 고정 열을 뺀 나머지. **가변(`<col>` 무지정)으로 두지 말 것**:
 * 가변이면 표가 남는 폭을 특이사항에 몰아줘 교시 폭이 카드와 달라진다(이 버그의 본체).
 */
export const TODAY_NOTE_W = TODAY_SLOT_W - FIXED_SUM;

/** 로스터 카드의 안쪽 여백(p-2.5) — 레일도 **같은 상자 모형**을 써야 첫 열의 시작점이 맞는다. */
export const TODAY_CARD_PAD = 10;

/** 표(그리고 레일 안쪽)의 총 폭 — 학생 열 + 교시들. */
export function todayContentWidth(slotCount: number): number {
  return TODAY_NAME_W + Math.max(0, slotCount) * TODAY_SLOT_W;
}

/** k번째 교시가 시작하는 x(내용 좌표) — 위아래가 같은 식을 써야 줄이 맞는다. */
export function todaySlotOffset(index: number): number {
  return TODAY_NAME_W + Math.max(0, index) * TODAY_SLOT_W;
}
