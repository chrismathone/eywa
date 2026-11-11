import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AnchorHTMLAttributes } from "react";
import { FollowupWorkspace } from "./followup-workspace";
import { fixture, managerId } from "./followup-fixtures.test-support";
import { EMPTY_FILTERS } from "./board-model";

// 병합 보정(2026-11-11) 가드 — ① '과목 기본 담당' 선택지는 그 과목에 기본 담당이 있을 때만(없는 기본값을 고르게 하지 않는다)
// ② 정착 관리 자료 조회가 실패해도 종전 '전체 완료 체크표'의 쓰기는 잠기지 않는다(`canWriteChecks`).
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), usePathname: () => "/newcomers", useSearchParams: () => new URLSearchParams() }));
vi.mock("./server/followup-actions", () => ({ assignNewcomerManager: vi.fn(), submitNewcomerFeedback: vi.fn(), reviewNewcomerFeedback: vi.fn() }));
vi.mock("./server/actions", () => ({ setOnboardingCheck: vi.fn() }));
vi.mock("@/features/owner/operations-context", () => ({ useSubjectMaps: () => ({ labelOf: (s: string) => (s === "math" ? "수학" : "영어") }) }));
vi.mock("@/components/embed-link", () => ({ EmbedLink: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
// 체크표 본체는 여기서 그리지 않는다 — 넘겨받는 쓰기 여부만 본다.
vi.mock("@/app/(shell)/newcomers/_components/newcomer-board", () => ({
  NewcomerBoard: ({ canWrite }: { canWrite: boolean }) => <div data-testid="board" data-can-write={String(canWrite)} />,
}));
afterEach(cleanup);

const managerSelect = () => screen.getByLabelText("30·60·90일 콜 관리 담당자");

it("'과목 기본 담당' 선택지는 그 과목에 기본 담당이 있을 때만, 누구인지와 함께 보인다", () => {
  render(<FollowupWorkspace {...fixture()} initialFilters={EMPTY_FILTERS} />);
  fireEvent.click(screen.getByRole("button", { name: "정착테스트" }));
  expect(within(managerSelect()).getByRole("option", { name: "과목 기본 담당 · 박관리" })).toBeInTheDocument();
  expect(managerSelect()).toHaveValue(managerId);
});

it("기본 담당이 없는 과목에는 '과목 기본 담당' 선택지를 내지 않는다", () => {
  const f = fixture();
  f.data.students[0].managers[0] = { ...f.data.students[0].managers[0], defaultManager: null };
  render(<FollowupWorkspace {...f} initialFilters={EMPTY_FILTERS} />);
  fireEvent.click(screen.getByRole("button", { name: "정착테스트" }));
  expect(within(managerSelect()).queryByRole("option", { name: /과목 기본 담당/ })).not.toBeInTheDocument();
  expect(managerSelect()).toHaveValue(managerId);
});

it("기본 담당을 따르는 과목은 '과목 기본 담당'이 골라져 있다", () => {
  render(<FollowupWorkspace {...fixture()} initialFilters={EMPTY_FILTERS} />);
  fireEvent.click(screen.getByRole("button", { name: "정착테스트 영어 관리 담당자" }));
  expect(within(managerSelect()).getByRole("option", { name: "과목 기본 담당 · 정유진" })).toBeInTheDocument();
  expect(managerSelect()).toHaveValue("default");
});

it("기본 담당을 따르던 과목의 기본 담당이 없어졌으면 '따름 · 지금 기본 담당 없음'으로 보인다(그대로 저장해도 미지정으로 굳지 않는다)", () => {
  const f = fixture();
  f.data.students[0].managers[1] = { ...f.data.students[0].managers[1], manager: null, defaultManager: null };
  render(<FollowupWorkspace {...f} initialFilters={EMPTY_FILTERS} />);
  fireEvent.click(screen.getByRole("button", { name: "정착테스트 영어 관리 담당자" }));
  expect(within(managerSelect()).getByRole("option", { name: "과목 기본 담당 따름 · 지금 기본 담당 없음" })).toBeInTheDocument();
  expect(managerSelect()).toHaveValue("default");
});

it("담당이 정해진 적 없고 기본 담당도 없는 과목은 '미지정'만 고를 수 있다", () => {
  const f = fixture();
  f.data.students[0].managers[1] = { subject: "english", manager: null, defaultManager: null, version: 0, source: "unassigned" };
  render(<FollowupWorkspace {...f} initialFilters={EMPTY_FILTERS} />);
  fireEvent.click(screen.getByRole("button", { name: "정착테스트 영어 관리 담당자" }));
  expect(within(managerSelect()).queryByRole("option", { name: /과목 기본 담당/ })).not.toBeInTheDocument();
  expect(managerSelect()).toHaveValue("");
});

it("정착 관리 자료 조회가 실패해도 종전 체크표의 쓰기는 잠기지 않는다", () => {
  const f = fixture();
  f.data.error = "조회 실패"; f.data.canManage = false; f.data.canReport = false; // canWriteChecks는 그대로(true)
  render(<FollowupWorkspace {...f} initialFilters={EMPTY_FILTERS} />);
  fireEvent.click(screen.getByRole("button", { name: "전체 완료 체크표" }));
  expect(screen.getByTestId("board")).toHaveAttribute("data-can-write", "true");
});

it("체크표 쓰기 권한이 없으면 체크표는 조회 전용으로 넘긴다", () => {
  const f = fixture();
  f.data.canManage = false; f.data.canWriteChecks = false;
  render(<FollowupWorkspace {...f} initialFilters={EMPTY_FILTERS} />);
  fireEvent.click(screen.getByRole("button", { name: "전체 완료 체크표" }));
  expect(screen.getByTestId("board")).toHaveAttribute("data-can-write", "false");
});
