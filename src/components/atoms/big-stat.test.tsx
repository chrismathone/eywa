import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BigStat } from "./big-stat";

afterEach(cleanup);

/**
 * `onClick`을 주면 카드 껍데기가 `<button>`이 된다(재고관리 '조치필요'). 버튼은 **phrasing content**만
 * 담을 수 있어서 안쪽을 `<div>`로 두면 무효한 HTML이다 — 브라우저는 견디지만 보조기기·파서가 갈린다(재리뷰 2026-09-04).
 */
describe("BigStat — 누를 수 있는 카드의 안쪽", () => {
  const BLOCKS = "div,p,ul,ol,table,section,h1,h2,h3";

  it("버튼일 때 안쪽에 블록 요소가 없다", () => {
    const { container } = render(
      <BigStat label="조치필요" value={15} unit="개" sub="분실 · 확인 · 미등록 · 수리" onClick={() => {}} />,
    );
    const btn = container.querySelector("button")!;
    expect(btn).toBeTruthy();
    expect(btn.querySelectorAll(BLOCKS).length).toBe(0);
  });

  it("누를 수 없으면 그냥 카드(div)라 `sub`에 블록을 넘겨도 된다 — 값·라벨·보조라인 그대로", () => {
    const { container } = render(
      <BigStat label="전체 반" value={164} unit="개" sub={<div>보강 반 제외</div>} />,
    );
    expect(container.querySelector("button")).toBeNull();
    // 🔴 span으로 바꾸면 이 자리(운영실 command-band처럼 컴포넌트를 넘기는 호출부)가 무효 중첩이 된다.
    expect(container.querySelector("span > div")).toBeNull();
    expect(container.textContent).toContain("전체 반");
    expect(container.textContent).toContain("164");
    expect(container.textContent).toContain("보강 반 제외");
  });
});
