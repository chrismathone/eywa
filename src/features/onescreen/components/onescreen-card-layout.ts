/**
 * 원스크린 카드 뷰의 열 — 화면 폭이 아니라 글자 배율 상자 안의 가용 폭(`@container/oscard`).
 *
 * 사이드바·창·배율은 그 상자의 폭에 이미 반영된다. 미디어쿼리(lg·1480px)로 가르지 않는다.
 * 3열 트랙 = 300 + 530 + 544 + gap 16×2 = 1406. 스위치는 1420(14px 여유, 예전 min-w와 같은 수).
 * 2열 = 300 + 530 + gap 16 = 846. 그보다 좁으면 학생·보고서가 세로로 쌓인다.
 * 1420 미만(휴대폰 포함)의 미리보기는 버튼 → 대화상자. 3열이 들어가면 우측 544.
 *
 * 클래스 문자열은 통째로 적는다. 이어 붙이면 Tailwind가 유틸을 못 본다.
 */
const STUDENT_COL_PX = 300;
const REPORT_MIN_PX = 530;
const GAP_PX = 16;

export const ONESCREEN_PREVIEW_WIDTH_PX = 544;
export const ONESCREEN_TWO_COL_MIN_PX = STUDENT_COL_PX + REPORT_MIN_PX + GAP_PX;
export const ONESCREEN_THREE_COL_TRACKS_PX =
  STUDENT_COL_PX + REPORT_MIN_PX + ONESCREEN_PREVIEW_WIDTH_PX + GAP_PX * 2;
/** 트랙 합보다 넓을 때만 3열. 1fr 칸이 여유를 먹어서 본문 가로 스크롤이 생기지 않는다. */
export const ONESCREEN_THREE_COL_MIN_PX = 1420;

/**
 * 배율 상자의 직계 자식. 쿼리는 자손에만 걸린다.
 * 846 미만의 적층 그리드는 내용 높이를 유지해 바깥 페이지가 스크롤된다.
 * viewport가 lg여도 글자 확대·사이드바 때문에 컨테이너는 그보다 좁을 수 있다.
 */
export const ONESCREEN_CARD_FRAME =
  "@container/oscard flex min-w-0 flex-col gap-3 lg:min-h-0 lg:flex-1";

export const ONESCREEN_CARD_GRID =
  "grid min-w-0 shrink-0 grid-cols-1 items-stretch gap-4 lg:@min-[846px]/oscard:min-h-0 lg:@min-[846px]/oscard:flex-1 @min-[846px]/oscard:grid-cols-[300px_minmax(530px,1fr)] @min-[1420px]/oscard:grid-cols-[300px_minmax(530px,1fr)_544px]";

export const ONESCREEN_PREVIEW_SCROLL =
  "scrollbar-thin min-h-0 min-w-0 lg:min-h-0 lg:overflow-y-auto lg:pr-1";

/** 좁으면 그리드에서 빠진다(display:none). 보고서 카드는 형제라 다시 마운트되지 않는다. */
export const ONESCREEN_PREVIEW_SLOT =
  "hidden min-h-0 min-w-0 scrollbar-thin lg:min-h-0 lg:overflow-y-auto lg:pr-1 @min-[1420px]/oscard:block";

export const ONESCREEN_PREVIEW_BUTTON = "@min-[1420px]/oscard:hidden";

export const ONESCREEN_EMPTY_SPAN = "@min-[1420px]/oscard:col-span-2";

/** 대화상자 안에서만. 페이지에 가로 스크롤 래퍼를 만들지 않는다. */
export const ONESCREEN_PREVIEW_DIALOG_SCROLL = "min-w-0 max-w-full overflow-x-auto";
