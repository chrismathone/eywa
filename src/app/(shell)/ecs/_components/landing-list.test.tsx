import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SheetLandingCard } from "@/features/class-sheets/server/queries";
import { EcsLandingList } from "./landing-list";

afterEach(cleanup);

function card(over: Partial<SheetLandingCard> = {}): SheetLandingCard {
  return {
    classId: "c1",
    className: "LS3b",
    teacherId: "t1",
    teacherName: "김태건",
    totalSlots: 6,
    filledSlots: 0,
    orphanSlots: 0,
    shoutingSlots: null,
    delegated: false,
    ...over,
  };
}

/** 행 링크 하나 = 반 한 줄. aria-label로 찾는다(행에는 열 머리가 없어 접근성 이름이 곧 계약이다). */
function row(className: string) {
  const link = screen.getAllByRole("link").find((a) => a.getAttribute("aria-label")?.startsWith(className));
  if (!link) throw new Error(`행을 못 찾음: ${className}`);
  return link;
}

describe("EcsLandingList — Shouting 구역", () => {
  it("EiE 반은 그 주 체크 수를 작성률과 **같은 분모**로 보여준다", () => {
    render(<EcsLandingList cards={[card({ shoutingSlots: 4, totalSlots: 6 })]} weekMonday="2026-08-24" />);
    expect(within(row("LS3b")).getByTitle("Shouting 체크 4/6교시 (이번 주)")).toHaveTextContent("4/6");
  });

  it("EiE가 아닌 반은 **빈 칸**이다 — 0/6으로 그리면 '해야 하는데 안 했다'는 거짓말", () => {
    render(
      <EcsLandingList
        cards={[card({ classId: "a", className: "JP2", shoutingSlots: 2 }), card({ classId: "b", className: "중등E_중1 TOP" })]}
        weekMonday="2026-08-24"
      />,
    );
    const r = row("중등E_중1 TOP");
    // ⚠️ 행 전체 텍스트로 판정하지 말 것 — 옆 작성률 칸도 `0/6`이라 같은 문자열이 나온다(첫 시도가 여기 걸렸다).
    expect(r.querySelector(".w-\\[52px\\]")!.textContent).toBe("");
    expect(within(r).queryByTitle(/Shouting/)).toBeNull();
    expect(r.getAttribute("aria-label")).not.toContain("Shouting");
  });

  it("EiE 반이 하나도 없는 뷰('인재원 영어' 필터)엔 구역 자체를 안 만든다 — 52px을 통째로 비울 이유가 없다", () => {
    render(<EcsLandingList cards={[card({ className: "중등E_중1 TOP" })]} weekMonday="2026-08-24" />);
    expect(row("중등E_중1 TOP").querySelector(".w-\\[52px\\]")).toBeNull();
  });

  it("🔴 EiE가 아닌 반도 **구역 폭은 그대로 잡는다** — 섞인 목록에서 오른쪽 숫자가 한 줄로 서야 한다", () => {
    render(
      <EcsLandingList
        cards={[card({ classId: "a", className: "JP2", shoutingSlots: 2 }), card({ classId: "b", className: "중등E_중1 TOP" })]}
        weekMonday="2026-08-24"
      />,
    );
    // 두 행 모두 같은 자리에 같은 폭의 칸이 있다(한쪽만 있으면 열이 어긋난다).
    for (const name of ["JP2", "중등E_중1 TOP"]) {
      expect(row(name).querySelectorAll(".w-\\[52px\\]")).toHaveLength(1);
    }
  });

  it("이 주 수업이 없는 EiE 반은 숫자를 안 낸다(작성률 칸이 '—'인 것과 같은 규약)", () => {
    render(<EcsLandingList cards={[card({ totalSlots: 0, shoutingSlots: 0 })]} weekMonday="2026-08-24" />);
    expect(row("LS3b").querySelector(".w-\\[52px\\]")!.textContent).toBe("");
  });

  it("전 교시 체크는 초록(의미 캐논 positive) — 남았으면 색을 안 쓴다", () => {
    render(
      <EcsLandingList
        cards={[card({ classId: "a", className: "JP2", shoutingSlots: 6 }), card({ classId: "b", className: "PJ1", shoutingSlots: 3 })]}
        weekMonday="2026-08-24"
      />,
    );
    expect(within(row("JP2")).getByTitle(/Shouting/).className).toContain("text-green");
    expect(within(row("PJ1")).getByTitle(/Shouting/).className).not.toContain("green");
  });

  it("머리 줄이 이 칸의 이름을 대신 말한다 — EiE 반이 없으면 항목 자체가 없다", () => {
    const { unmount } = render(<EcsLandingList cards={[card({ shoutingSlots: 2 })]} weekMonday="2026-08-24" />);
    expect(screen.getByText("Shouting").parentElement).toHaveTextContent("2/6");
    unmount();
    render(<EcsLandingList cards={[card()]} weekMonday="2026-08-24" />);
    expect(screen.queryByText("Shouting")).toBeNull();
  });

  it("스크린리더에도 되돌린다 — 행에는 열 머리가 없다", () => {
    render(<EcsLandingList cards={[card({ shoutingSlots: 4 })]} weekMonday="2026-08-24" />);
    expect(row("LS3b").getAttribute("aria-label")).toContain("Shouting 체크 4/6교시");
  });
});
