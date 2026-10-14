/** 키 모양(X · ← → · Esc) — 겹침 카드와 아래 안내 줄이 같은 모양을 쓴다. */
export const KBD_CLASS =
  "border-line-strong bg-card inline-flex min-w-[1.6em] items-center justify-center rounded border border-b-2 px-1 font-sans text-xs font-bold";

/**
 * 시간표 맨 아래 안내 한 줄 — X를 누르면 퇴원이 뜬다는 것(원장 2026-10-14 *"하단 여백 공간에 x를 누르면 퇴원을 볼 수 있다
 * 같은 간단한 안내문구. 영어시간표와 수학시간표 하단 여백 통일"*).
 * 🔑 이 줄이 **아래 여백 자리를 대신한다** — 표식 `.timetable-footnote`가 있으면 셸 `<main>`의 아래 패딩이 0이 되고
 *    (globals.css), 줄 높이(위 간격 + h-8)가 곧 아래 여백이다. 모든 뷰(기본·통합·강사·보강)의 마지막 줄이라 영어·수학이 같은 여백이 된다.
 * 터치 기기(키보드 없음)에서는 글자만 감추고 자리는 남긴다(여백이 같아야 하므로).
 */
export function ExitOverlayHint() {
  return (
    <p className="timetable-footnote -mt-2 flex h-8 shrink-0 items-center gap-1 px-1 text-xs compact-chrome:-mt-1 pointer-coarse:invisible">
      <kbd className={KBD_CLASS}>X</kbd>를 누르면 마우스 옆에 석 달 퇴원이 뜹니다.
    </p>
  );
}
