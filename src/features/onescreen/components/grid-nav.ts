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
  const table = el.closest("table");
  if (!table) return;
  const dir = e.key === "ArrowUp" ? -1 : 1;
  /**
   * 🔴 **잠긴 행의 칸은 건너뛴다.** disabled 입력엔 `focus()`가 안 먹으므로, 그 자리에서 멈추면
   *    Enter를 눌러도 커서가 그대로 = "눌렀는데 무반응"이 된다. 결석 행 입력을 잠그면서(2026-08-07)
   *    실제로 생길 수 있는 상황이 됐다 — 결석 학생 한 명이 반 전체의 Enter 흐름을 끊는다.
   * (readOnly는 포커스가 되므로 대상 아님 — 값을 읽거나 복사할 수 있는 편이 낫다.)
   */
  for (let r = row + dir; r >= 0; r += dir) {
    const target = table.querySelector<HTMLInputElement>(
      `input[data-nav-col="${col}"][data-nav-row="${r}"]`,
    );
    if (!target) return; // 그 열의 끝(행 인덱스는 연속이라 빈 자리는 곧 끝이다)
    if (target.disabled) continue;
    e.preventDefault();
    target.focus();
    target.select();
    return;
  }
}
