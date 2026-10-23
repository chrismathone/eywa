/**
 * **hover 카드 껍데기** — 시간표 학생/수업 카드([hover-cards.tsx](<../../app/(shell)/timetable/_components/hover-cards.tsx>))와
 * 앱 전역 메모 툴팁([hover-tip-layer.tsx](./hover-tip-layer.tsx))이 **같은 값**을 쓴다.
 * F1 화면 도움말 캡션도 **껍데기만** 공유한다. 히트 테스트는 `pointer-events-auto`(hover의
 * `pointer-events-none`을 베끼지 말 것 — 카드 안에서 스크롤한다).
 *
 * 🔴 원장 2026-09-15 *"왠만하면 모든 곳의 메모는 시간표에서 사진올린것처럼 생기면 좋겠네. 그냥 메모처럼하니까
 *    너무 보기가 불편하다랄까?"* — 브라우저 기본 툴팁(`title`)의 그 회색 메모 상자를 앱 카드로 바꾼 결정이다.
 *    두 곳이 각자 클래스를 적으면 그 순간부터 같은 화면에 서로 다른 카드가 뜬다.
 * ⚠️ 폭·최대 높이는 **위치 클램프와 같은 값**이어야 카드가 화면 밖으로 안 나간다(옛 코드가 높이를 추정해 잘렸다).
 */

/** 카드 테두리·면·그림자(안쪽 여백 없음) — 안을 직접 나누는 상자(시간표 칸 메모 편집 상자)가 쓴다. */
export const HOVER_CARD_FRAME = "border-line bg-card shadow-modal rounded-lg border";

/** 카드 상자 — 흰 면 + 헤어라인 테두리 + 떠 있는 그림자(팔레트 v4). */
export const HOVER_CARD_SHELL = `${HOVER_CARD_FRAME} p-3`;

/** 카드 최대 높이(px) — 넘치면 카드 안에서 스크롤한다. */
export const HOVER_CARD_MAX_H = 320;

/** 카드 기본 폭(px) — 시간표 학생 카드와 같은 값. */
export const HOVER_CARD_WIDTH = 240;
