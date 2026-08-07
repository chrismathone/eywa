import type { KeyboardEvent } from "react";

/** 표 셀에서 세로 이동을 받는 컨트롤 — input과(2026-08-07부터) 한 줄 높이 textarea. */
type GridCell = HTMLInputElement | HTMLTextAreaElement;

/**
 * 표 키보드 세로 이동(3-1) — Enter/↓ = 같은 열 다음 행, ↑ = 이전 행.
 * 셀 input에 data-nav-col(열 이름) + data-nav-row(행 인덱스)를 달고 onKeyDown으로 연결한다.
 * ⚠️ IME 가드: 한글 조합 중 Enter는 글자 확정이므로 무시(e.nativeEvent.isComposing).
 *
 * 2026-08-07 확장: 진도·오늘 과제 셀이 **한 줄 높이 textarea**가 됐다(ECS 시트 초안이 여러 줄이라
 * 한 줄 input에선 "Vocab 41 42Reading…"으로 붙어 보였다). 표에서 Enter의 뜻은 여전히 **다음 행**이고,
 * 줄을 새로 넣고 싶으면 **Shift+Enter**다(줄바꿈이 필요한 칸이 생겼으니 탈출구를 남긴다).
 * 멘트 등 여러 줄 textarea는 애초에 이 핸들러를 안 단다(Enter=줄바꿈 그대로).
 */
export function handleGridNavKey(e: KeyboardEvent<GridCell>) {
  if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  if (e.nativeEvent.isComposing) return;
  // Shift+Enter = 줄바꿈(textarea에서만 의미가 있고, input에선 아무 일도 안 일어난다).
  if (e.key === "Enter" && e.shiftKey) return;
  const el = e.currentTarget;
  const col = el.dataset.navCol;
  const row = Number(el.dataset.navRow);
  if (!col || Number.isNaN(row)) return;
  const next = row + (e.key === "ArrowUp" ? -1 : 1);
  const target = el
    .closest("table")
    ?.querySelector<GridCell>(
      `input[data-nav-col="${col}"][data-nav-row="${next}"], textarea[data-nav-col="${col}"][data-nav-row="${next}"]`,
    );
  if (!target) return;
  e.preventDefault();
  target.focus();
  target.select();
}
