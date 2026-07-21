import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusBoard } from "./status-board";
import type { OneScreenStudent } from "../types";

afterEach(cleanup);

const subject = (over: Partial<OneScreenStudent["subjects"][number]> = {}) => ({
  name: "수학",
  prev: "",
  today: "p.10",
  className: null as string | null,
  ...over,
});

const student = (over: Partial<OneScreenStudent>): OneScreenStudent =>
  ({
    id: over.id ?? "s1",
    name: over.name ?? "학생",
    grade: "중3",
    tag: "중3",
    attendance: "출석",
    subjects: over.subjects ?? [subject()],
    tests: {},
    attitude: null,
    homework: "—",
    ...over,
  }) as OneScreenStudent;

/** 반 머리행(콜스팬 th)들의 반 이름만 순서대로. */
function groupNames() {
  return [...document.querySelectorAll("tbody th[colspan]")].map(
    (th) => th.querySelector("span")?.textContent?.trim() ?? "",
  );
}
/** 데이터 행의 학생 이름만 순서대로(머리행 제외). */
function studentOrder() {
  return [...document.querySelectorAll("tbody tr")]
    .filter((tr) => !tr.querySelector("th[colspan]"))
    .map((tr) => tr.querySelector("td span")?.textContent?.trim() ?? "");
}

const STUDENTS: OneScreenStudent[] = [
  student({ id: "a", name: "최영서", subjects: [subject({ className: "중3 CR3D" })] }),
  student({ id: "b", name: "김민승", subjects: [subject({ className: "중2 PS2S" })] }),
  student({ id: "c", name: "박라임", subjects: [subject({ className: "중3 CR3D" })] }),
  student({ id: "d", name: "이도경", subjects: [subject({ className: null })] }), // 반 모호 → 미배정
];

describe("StatusBoard 반별 묶기", () => {
  it("반마다 머리행으로 묶고, 반 미배정은 항상 끝", () => {
    render(<StatusBoard students={STUDENTS} reports={{}} onOpenCard={vi.fn()} />);
    expect(groupNames()).toEqual(["중2 PS2S", "중3 CR3D", "반 미배정"]);
  });

  it("반 머리행에 인원 + 그 반의 미작성 수가 보인다(급한 반이 바로 보이게)", () => {
    // 진도가 비면 미작성(todo), 채워져 있으면 작성중(draft) — rowSendStatus 규약.
    const rows = [
      student({ id: "a", name: "최영서", subjects: [subject({ className: "중3 CR3D", today: "" })] }),
      student({ id: "c", name: "박라임", subjects: [subject({ className: "중3 CR3D", today: "p.10" })] }),
    ];
    render(<StatusBoard students={rows} reports={{}} onOpenCard={vi.fn()} />);
    const head = document.querySelector("tbody th[colspan]");
    expect(head?.textContent).toContain("2명");
    expect(head?.textContent).toContain("미작성 1");
  });

  it("그 반이 전부 작성됐으면 '전원 작성'", () => {
    const rows = [student({ id: "c", name: "박라임", subjects: [subject({ className: "중3 CR3D" })] })];
    render(<StatusBoard students={rows} reports={{}} onOpenCard={vi.fn()} />);
    expect(document.querySelector("tbody th[colspan]")?.textContent).toContain("전원 작성");
  });

  it("행 클릭 시 그 학생 카드로 연다", () => {
    const onOpenCard = vi.fn();
    render(<StatusBoard students={STUDENTS} reports={{}} onOpenCard={onOpenCard} />);
    const row = [...document.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("박라임"));
    fireEvent.click(row!);
    expect(onOpenCard).toHaveBeenCalledWith("c");
  });
});

describe("StatusBoard 헤더 정렬", () => {
  it("학생 열을 누르면 **반 묶음은 유지한 채** 그룹 안에서 가나다 정렬", () => {
    render(<StatusBoard students={STUDENTS} reports={{}} onOpenCard={vi.fn()} />);
    // 정렬 전: 입력 순서(중3 그룹은 최영서 → 박라임)
    expect(studentOrder()).toEqual(["김민승", "최영서", "박라임", "이도경"]);
    fireEvent.click(screen.getByRole("button", { name: /학생 · 반/ }));
    expect(groupNames()).toEqual(["중2 PS2S", "중3 CR3D", "반 미배정"]); // 묶음 그대로
    expect(studentOrder()).toEqual(["김민승", "박라임", "최영서", "이도경"]); // 그룹 안만 정렬
  });

  it("한 번 더 누르면 내림차순, 세 번째엔 원래 순서로 돌아온다", () => {
    render(<StatusBoard students={STUDENTS} reports={{}} onOpenCard={vi.fn()} />);
    const th = screen.getByRole("button", { name: /학생 · 반/ });
    fireEvent.click(th); // 오름
    fireEvent.click(th); // 내림 — 중3 그룹이 최영서 → 박라임 순
    expect(studentOrder()).toEqual(["김민승", "최영서", "박라임", "이도경"]);
    fireEvent.click(th); // 해제
    expect(studentOrder()).toEqual(["김민승", "최영서", "박라임", "이도경"]); // 해제 = 원래 순서
  });
});
