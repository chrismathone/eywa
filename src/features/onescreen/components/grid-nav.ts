import type { KeyboardEvent } from "react";

/**
 * 표 키보드 세로 이동(3-1) — Enter/↓ = 같은 열 다음 행, ↑ = 이전 행.
 * 셀 input에 data-nav-col(열 이름) + data-nav-row(행 인덱스)를 달고 onKeyDown으로 연결한다.
 * ⚠️ IME 가드: 한글 조합 중 Enter는 글자 확정이므로 무시(e.nativeEvent.isComposing).
 * textarea는 대상 아님(Enter=줄바꿈).
 */
export function handleGridNavKey(e: KeyboardEvent<HTMLInputElement>) {
  if (e.key !== "Enter" && e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  if (e.nativeEvent.isComposing) return;
  const el = e.currentTarget;
  const col = el.dataset.navCol;
  const row = Number(el.dataset.navRow);
  if (!col || Number.isNaN(row)) return;
  const next = row + (e.key === "ArrowUp" ? -1 : 1);
  const target = el
    .closest("table")
    ?.querySelector<HTMLInputElement>(`input[data-nav-col="${col}"][data-nav-row="${next}"]`);
  if (!target) return;
  e.preventDefault();
  target.focus();
  target.select();
}
