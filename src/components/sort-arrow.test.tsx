import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SortArrow } from "./sort-arrow";

describe("원생목록 열 머리 정렬 화살표(원장 2026-10-14)", () => {
  afterEach(cleanup);
  it("글자 없는 화살표 = 읽어 주는 이름이 누르면 걸릴 정렬", () => {
    render(<SortArrow active={false} dir="asc" href="/students?sort=grade" label="학년 오름차순 정렬" />);
    expect(screen.getByRole("link", { name: "학년 오름차순 정렬" })).toHaveAttribute("href", "/students?sort=grade");
  });
  it("열 이름이 든 링크는 이름을 덮지 않고 정렬은 설명으로 — 열 제목에 정렬 문구가 섞이지 않는다", () => {
    render(
      <table><thead><tr><th>
        <SortArrow active dir="asc" href="/students?sort=name_desc" label="이름 내림차순 정렬" hintId="hint">이름</SortArrow>
      </th></tr></thead></table>,
    );
    const link = screen.getByRole("link", { name: "이름" });
    expect(link).toHaveAccessibleDescription("이름 내림차순 정렬");
    expect(screen.getByRole("columnheader", { name: "이름" })).toBeInTheDocument();
  });
});
