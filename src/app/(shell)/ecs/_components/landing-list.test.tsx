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
    englishTrack: null,
    totalSlots: 6,
    filledSlots: 0,
    orphanSlots: 0,
    shoutingSlots: null,
    delegated: false,
    ...over,
  };
}

/**
 * EiE 반 한 장 — 서버 불변식대로 `englishTrack`과 `shoutingSlots`가 **함께** 온다.
 * (둘을 따로 두면 실제로는 나올 수 없는 상태를 테스트하게 된다: 트랙은 인재원인데 체크 수가 있는 반.)
 */
function eie(over: Partial<SheetLandingCard> = {}): SheetLandingCard {
  return card({ englishTrack: "eie", shoutingSlots: 0, ...over });
}

/**
 * **행 링크만** — 2026-09-01부터 EiE 행에는 계획(MP) 링크가 형제로 하나 더 붙는다(주간 시트로 가는
 * 행 링크와 월간 계획서로 가는 알약이 같은 `<li>` 안에 나란히 선다). 둘을 안 가르면 "반이 두 번 셌다"가
 * 되므로, 여기서는 **가는 곳**으로 가른다(행=`?week=`, MP=`/month`).
 */
const isRowLink = (a: Element) => !(a.getAttribute("href") ?? "").includes("/month");

/** 행 링크 하나 = 반 한 줄. aria-label로 찾는다(행에는 열 머리가 없어 접근성 이름이 곧 계약이다). */
function row(className: string) {
  const link = screen
    .getAllByRole("link")
    .filter(isRowLink)
    .find((a) => a.getAttribute("aria-label")?.startsWith(className));
  if (!link) throw new Error(`행을 못 찾음: ${className}`);
  return link;
}

/** 그 반의 계획(MP) 링크 — 없으면 null(인재원 영어·미분류 반은 이 문이 없다). */
function mpLink(className: string) {
  return (
    screen
      .getAllByRole("link")
      .find((a) => !isRowLink(a) && a.getAttribute("aria-label")?.startsWith(className)) ?? null
  );
}

/**
 * Shouting 구역(폭 52px) 셀렉터. ⚠️ `.w-\[52px\]`처럼 **클래스 셀렉터로 쓰지 말 것** — 역슬래시가
 * 한 겹만 남으면 jsdom이 조용히 0개를 돌려줘 "빈 칸이다" 쪽 단언이 거짓으로 통과한다(실제로 밟았다).
 * 속성 셀렉터는 값이 따옴표 안이라 대괄호를 그대로 쓴다.
 */
const ZONE = "[class~='w-[52px]']";

/** 프로그램 단 하나 — 제목(h3)에서 거슬러 올라간다(담임 묶음은 단 안에서 h4다). */
function panel(label: string) {
  return screen.getByRole("heading", { level: 3, name: label }).closest("section")!;
}

/** 그 단에 실제로 들어간 반 이름들. */
function classNamesIn(el: HTMLElement) {
  return within(el)
    .getAllByRole("link")
    .filter(isRowLink)
    .map((a) => a.getAttribute("aria-label")!.split(",")[0]);
}

describe("EcsLandingList — Shouting 구역", () => {
  it("EiE 반은 그 주 체크 수를 작성률과 **같은 분모**로 보여준다", () => {
    render(<EcsLandingList cards={[eie({ shoutingSlots: 4, totalSlots: 6 })]} weekMonday="2026-08-24" />);
    expect(within(row("LS3b")).getByTitle("Shouting 체크 4/6교시 (이번 주)")).toHaveTextContent("4/6");
  });

  it("EiE가 아닌 반엔 Shouting이 아예 안 붙는다 — `0/6`으로 그리면 '해야 하는데 안 했다'는 거짓말", () => {
    render(
      <EcsLandingList
        cards={[
          eie({ classId: "a", className: "JP2", shoutingSlots: 2 }),
          card({ classId: "b", className: "중등E_중1 TOP", englishTrack: "injaewon" }),
        ]}
        weekMonday="2026-08-24"
      />,
    );
    const r = row("중등E_중1 TOP");
    // ⚠️ 행 전체 텍스트로 판정하지 말 것 — 옆 작성률 칸도 `0/6`이라 같은 문자열이 나온다(첫 시도가 여기 걸렸다).
    expect(within(r).queryByTitle(/Shouting/)).toBeNull();
    expect(r.getAttribute("aria-label")).not.toContain("Shouting");
    // 좌우로 갈리면 인재원 단엔 EiE가 한 반도 없다 → 52px 구역 자체가 없다(그 폭은 긴 반 이름에 돌아간다).
    expect(r.querySelector(ZONE)).toBeNull();
  });

  it("EiE 반이 하나도 없는 뷰('인재원 영어' 필터)엔 구역 자체를 안 만든다 — 52px을 통째로 비울 이유가 없다", () => {
    render(<EcsLandingList cards={[card({ className: "중등E_중1 TOP" })]} weekMonday="2026-08-24" />);
    expect(row("중등E_중1 TOP").querySelector(ZONE)).toBeNull();
  });

  it("🔴 같은 단 안에선 숫자가 없는 반도 **구역 폭을 그대로 잡는다** — 한 줄만 짧아지면 열이 어긋난다", () => {
    render(
      <EcsLandingList
        cards={[
          eie({ classId: "a", className: "JP2", shoutingSlots: 2 }),
          eie({ classId: "b", className: "LS5", totalSlots: 0, shoutingSlots: 0 }),
        ]}
        weekMonday="2026-08-24"
      />,
    );
    for (const name of ["JP2", "LS5"]) {
      expect(row(name).querySelectorAll(ZONE)).toHaveLength(1);
    }
    expect(row("LS5").querySelector(ZONE)!.textContent).toBe("");
  });

  it("이 주 수업이 없는 EiE 반은 숫자를 안 낸다(작성률 칸이 '—'인 것과 같은 규약)", () => {
    render(<EcsLandingList cards={[eie({ totalSlots: 0, shoutingSlots: 0 })]} weekMonday="2026-08-24" />);
    expect(row("LS3b").querySelector(ZONE)!.textContent).toBe("");
  });

  it("전 교시 체크는 초록(의미 캐논 positive) — 남았으면 색을 안 쓴다", () => {
    render(
      <EcsLandingList
        cards={[
          eie({ classId: "a", className: "JP2", shoutingSlots: 6 }),
          eie({ classId: "b", className: "PJ1", shoutingSlots: 3 }),
        ]}
        weekMonday="2026-08-24"
      />,
    );
    expect(within(row("JP2")).getByTitle(/Shouting/).className).toContain("text-green");
    expect(within(row("PJ1")).getByTitle(/Shouting/).className).not.toContain("green");
  });

  it("머리 줄이 이 칸의 이름을 대신 말한다 — EiE 반이 없으면 항목 자체가 없다", () => {
    const { unmount } = render(<EcsLandingList cards={[eie({ shoutingSlots: 2 })]} weekMonday="2026-08-24" />);
    expect(screen.getByText("Shouting").parentElement).toHaveTextContent("2/6");
    unmount();
    render(<EcsLandingList cards={[card()]} weekMonday="2026-08-24" />);
    expect(screen.queryByText("Shouting")).toBeNull();
  });

  it("스크린리더에도 되돌린다 — 행에는 열 머리가 없다", () => {
    render(<EcsLandingList cards={[eie({ shoutingSlots: 4 })]} weekMonday="2026-08-24" />);
    expect(row("LS3b").getAttribute("aria-label")).toContain("Shouting 체크 4/6교시");
  });
});

describe("EcsLandingList — 프로그램 좌우 분단", () => {
  const mixed = [
    eie({ classId: "a", className: "JP2", shoutingSlots: 2, filledSlots: 6, totalSlots: 6 }),
    card({ classId: "b", className: "중등E_중1 TOP", englishTrack: "injaewon", filledSlots: 0, totalSlots: 6 }),
  ];

  it("섞이면 두 단이 서고 **EiE가 왼쪽** — 각 단은 자기 프로그램 반만 담는다", () => {
    render(<EcsLandingList cards={mixed} weekMonday="2026-08-24" />);
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "EiE",
      "인재원 영어",
    ]);
    expect(classNamesIn(panel("EiE"))).toEqual(["JP2"]);
    expect(classNamesIn(panel("인재원 영어"))).toEqual(["중등E_중1 TOP"]);
  });

  it("한 프로그램뿐이면 나누지 않는다 — 반쪽을 비워 둘 이유가 없다", () => {
    render(<EcsLandingList cards={[eie({ className: "JP2", shoutingSlots: 2 })]} weekMonday="2026-08-24" />);
    expect(screen.queryByRole("heading", { level: 3, name: "EiE" })).toBeNull();
    // 담임 묶음은 단 밖이라 h3 그대로(제목 층이 안 뜬다).
    expect(screen.getByRole("heading", { level: 3, name: "김태건" })).toBeTruthy();
  });

  it("미분류 반도 사라지지 않는다 — 인재원 단에 든다", () => {
    render(
      <EcsLandingList
        cards={[eie({ classId: "a", className: "JP2", shoutingSlots: 2 }), card({ classId: "b", className: "미분류반" })]}
        weekMonday="2026-08-24"
      />,
    );
    expect(classNamesIn(panel("인재원 영어"))).toEqual(["미분류반"]);
  });

  it("단 머리의 작성률은 **그 단 몫만** 센다(옆 단 숫자가 섞이면 프로그램별로 못 읽는다)", () => {
    render(<EcsLandingList cards={mixed} weekMonday="2026-08-24" />);
    expect(within(panel("EiE")).getByText("작성")).toHaveTextContent("6/6");
    expect(within(panel("인재원 영어")).getByText("작성")).toHaveTextContent("0/6");
    // 머리 줄(전체)은 둘을 합한 값 그대로.
    expect(screen.getByText("교시 작성")).toHaveTextContent("6/12");
  });

  it("🔴 창이 좁으면 **1단 상하** — 두 단이 위아래로 쌓이고 단 안도 한 열이다(원장 2026-08-28)", () => {
    render(<EcsLandingList cards={mixed} weekMonday="2026-08-24" />);
    const grid = panel("EiE").parentElement!;
    // 기본이 1열(상하), 넓어지면 좌우.
    expect(grid.className).toContain("grid-cols-1");
    expect(grid.className).toContain("md:grid-cols-2");
    const flow = panel("EiE").querySelector("div[class*='columns-']")!;
    expect(flow.className).toContain("columns-1");
    // 좁은 폭에 열을 더 쪼개는 변형이 붙으면 그 지시가 깨진다 — 2열은 xl(1280px)부터만.
    expect(flow.className).not.toMatch(/(sm|md|lg):columns-/);
    expect(flow.className).toContain("xl:columns-2");
  });

  it("🔴 프로그램 라벨·담임 이름은 **크게 + 강조**(원장 2026-08-28) — 다시 줄이지 말 것", () => {
    render(<EcsLandingList cards={mixed} weekMonday="2026-08-24" />);
    // 크기는 **하한만** 잠근다(더 키우는 건 자유, 되돌리는 것만 막는다).
    const px = (el: Element) => Number(/text-\[(\d+)px\]/.exec(el.className)?.[1] ?? 0);
    const label = screen.getByRole("heading", { level: 3, name: "EiE" });
    expect(px(label)).toBeGreaterThanOrEqual(16);
    expect(label.className).toContain("font-extrabold");
    const teacher = screen.getAllByRole("heading", { level: 4, name: "김태건" })[0]!;
    expect(px(teacher)).toBeGreaterThanOrEqual(15);
    expect(teacher.className).toContain("font-extrabold");
    // 포함 관계가 크기로도 읽혀야 한다 — 간판(프로그램)이 담임보다 작아지면 위계가 뒤집힌다.
    expect(px(label)).toBeGreaterThan(px(teacher));
  });

  it("한 담임이 두 프로그램을 맡으면 **양쪽 단에 묶음이 하나씩**, 머리 줄 담임 수는 1명", () => {
    render(<EcsLandingList cards={mixed} weekMonday="2026-08-24" />);
    // 단 안에서는 담임이 프로그램 아래 층(h4)이다.
    expect(screen.getAllByRole("heading", { level: 4, name: "김태건" })).toHaveLength(2);
    expect(screen.getByText(/^담임/)).toHaveTextContent("담임 1명");
  });
});

/**
 * 계획(MP) 진입로 — 🔴 **여기 없으면 주소를 아는 사람만 쓴다**(MCS에서 수학만 맡은 강사 9명에게
 * 링크가 0개였던 것과 같은 구멍). 그리고 MP는 **EiE 반에만** 있다(원장 2026-09-01).
 */
describe("EcsLandingList — 계획(MP) 진입로", () => {
  it("EiE 반에는 MP 링크가 붙고, 여는 달은 그 주가 속한 달이다", () => {
    // 2026-08-31(월) 주는 목요일이 9/3이라 **9월** 주다(monthOfWeek — 월요일의 달이 아니다).
    render(<EcsLandingList cards={[eie({ className: "JP2" })]} weekMonday="2026-08-31" />);
    const link = mpLink("JP2");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("/ecs/c1/month?month=2026-09&week=2026-08-31&view=mp");
  });

  it("🔴 인재원 영어·미분류 반에는 붙지 않는다(정확히 일치하는 반에만 연다)", () => {
    render(
      <EcsLandingList
        cards={[
          card({ classId: "c2", className: "중등E_중1 TOP", englishTrack: "injaewon" }),
          card({ classId: "c3", className: "미분류반", englishTrack: null }),
        ]}
        weekMonday="2026-08-24"
      />,
    );
    expect(mpLink("중등E_중1 TOP")).toBeNull();
    expect(mpLink("미분류반")).toBeNull();
  });
});
