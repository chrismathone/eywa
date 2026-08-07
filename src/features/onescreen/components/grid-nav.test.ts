import { describe, it, expect, afterEach } from "vitest";
import { handleGridNavKey } from "./grid-nav";
import type { KeyboardEvent } from "react";

/** 표 한 열을 흉내낸 DOM — 행 인덱스 순서대로 input을 깐다. `disabled`에 든 행은 잠긴 행. */
function mountColumn(rows: number, disabled: number[] = []) {
  document.body.innerHTML = `<table><tbody>${Array.from({ length: rows })
    .map(
      (_, i) =>
        `<tr><td><input data-nav-col="homework" data-nav-row="${i}"${
          disabled.includes(i) ? " disabled" : ""
        } /></td></tr>`,
    )
    .join("")}</tbody></table>`;
  return Array.from(document.querySelectorAll<HTMLInputElement>("input"));
}

/** React KeyboardEvent 흉내 — 이 헬퍼가 실제로 쓰는 필드만 채운다. */
function keyEvent(el: HTMLInputElement, key: string) {
  let prevented = false;
  return {
    key,
    currentTarget: el,
    nativeEvent: { isComposing: false },
    preventDefault: () => {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  } as unknown as KeyboardEvent<HTMLInputElement> & { defaultPrevented: boolean };
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("handleGridNavKey", () => {
  it("Enter/↓는 같은 열 다음 행으로, ↑는 이전 행으로", () => {
    const inputs = mountColumn(3);
    handleGridNavKey(keyEvent(inputs[0]!, "Enter"));
    expect(document.activeElement).toBe(inputs[1]);
    handleGridNavKey(keyEvent(inputs[1]!, "ArrowUp"));
    expect(document.activeElement).toBe(inputs[0]);
  });

  // 🔴 결석·발송완료 행은 입력이 disabled라 `focus()`가 안 먹는다 — 멈추면 "Enter를 눌렀는데 무반응".
  it("잠긴(disabled) 행은 건너뛰고 그 다음 살아 있는 행으로 간다", () => {
    const inputs = mountColumn(4, [1, 2]);
    handleGridNavKey(keyEvent(inputs[0]!, "Enter"));
    expect(document.activeElement).toBe(inputs[3]);
  });

  it("남은 행이 전부 잠겼으면 아무 일도 하지 않는다(커서 유지)", () => {
    const inputs = mountColumn(3, [1, 2]);
    inputs[0]!.focus();
    handleGridNavKey(keyEvent(inputs[0]!, "Enter"));
    expect(document.activeElement).toBe(inputs[0]);
  });

  it("마지막 행에서 더 내려가지 않는다", () => {
    const inputs = mountColumn(2);
    inputs[1]!.focus();
    handleGridNavKey(keyEvent(inputs[1]!, "ArrowDown"));
    expect(document.activeElement).toBe(inputs[1]);
  });

  it("한글 조합 중 Enter는 글자 확정이라 이동하지 않는다", () => {
    const inputs = mountColumn(2);
    inputs[0]!.focus();
    const e = keyEvent(inputs[0]!, "Enter");
    (e.nativeEvent as { isComposing: boolean }).isComposing = true;
    handleGridNavKey(e);
    expect(document.activeElement).toBe(inputs[0]);
  });
});
