import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// 메뉴 제목 개명은 이 테스트의 관심 밖(내비 설정 공급자가 필요하다) — 받은 제목 그대로.
vi.mock("@/features/owner/menu-page-title", () => ({ MenuPageTitle: ({ title }: { title: string }) => title }));

import { PageHeader, PageHeaderSkeleton } from "./page-header";

/** 한 줄 헤더(원장 2026-10-01 *"구조도 3행이 아니라 1행으로 — 수업운영 - 시간표 - 주간 시간표"*). */
describe("PageHeader 한 줄", () => {
  it("eyebrow - 제목 - 설명이 한 묶음(같은 줄 flex)에 서고 구분자는 읽지 않는다", () => {
    const { container } = render(<PageHeader eyebrow="수업 운영" title="시간표" description="수학 주간표" />);
    const heading = screen.getByRole("heading", { name: "시간표" });
    const group = heading.parentElement!.parentElement!;
    expect(group.className).toContain("flex-wrap");
    expect(group.textContent).toBe("수업 운영-시간표-수학 주간표");
    expect(group.querySelectorAll("[aria-hidden]")).toHaveLength(2);
    // 구분자는 뒤 항목과 한 덩어리 — 줄이 꺾여도 ` - `가 앞 줄 끝에 홀로 남지 않는다.
    expect(heading.parentElement!.textContent).toBe("-시간표");
    expect(container.querySelectorAll("header")).toHaveLength(1);
  });

  it("eyebrow·설명이 없으면 제목만(구분자 없음)", () => {
    const { container } = render(<PageHeader title="시간표" />);
    expect(container.querySelectorAll("[aria-hidden]")).toHaveLength(0);
  });

  it("동작이 없으면 오른쪽 칸은 비어(empty:hidden) 자리를 안 먹고, 있으면 같은 줄 오른쪽에 선다", () => {
    const none = render(<PageHeader title="시간표" />);
    const slot = none.container.querySelector("header > div > div:last-child")!;
    expect(slot.children).toHaveLength(0);
    expect(slot.className).toContain("empty:hidden");
    none.unmount();
    render(<PageHeader title="시간표" actions={<button type="button">새로 만들기</button>} />);
    expect(screen.getByRole("button", { name: "새로 만들기" })).toBeTruthy();
  });

  it("스켈레톤도 같은 한 줄 헤더 껍데기(구분선 포함)", () => {
    const { container } = render(<PageHeaderSkeleton />);
    expect(container.querySelector("header")!.className).toContain("border-b");
  });
});
