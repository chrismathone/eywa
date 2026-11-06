import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { CareCommitmentView, CareExploreView } from "../server/explore";
import { CareExploreBlock } from "./care-explore-block";

const m = vi.hoisted(() => ({ save: vi.fn(), options: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh }) }));
vi.mock("../server/actions", () => ({ saveCare: m.save, listCareEvidenceOptions: m.options }));
vi.mock("@/components/workspace/window-link", () => ({ WindowLink: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));

const student = "00000000-0000-4000-8000-000000000003";
const commitment = (over: Partial<CareCommitmentView> = {}): CareCommitmentView => ({
  id: "c1", version: 3, revision: 2, state: "open", promise: "중3 선행 시작", need: "중3 선행 희망", criterion: "단원 평가 확인",
  dueOn: "2026-11-30", subject: "수학", ownerName: "박지훈", acknowledged: true, closedOn: null, closedByName: null,
  evidence: [{ kind: "lesson_report", kindLabel: "수업보고서", recordId: "r1", note: "3단원 완료", at: "2026-11-01T00:00:00Z", href: "/lesson_reports/r1/print" }],
  ...over,
});
const view = (over: Partial<CareExploreView> = {}): CareExploreView => ({
  state: "ready", commitments: [commitment()], canManage: true, canContribute: true, careHref: `/students/${student}/care`, intake: null, ...over,
});

beforeEach(() => { vi.clearAllMocks(); m.save.mockResolvedValue({ ok: true }); });
afterEach(cleanup);

describe("연결 탐색 '약속·할 일' 조각", () => {
  it("상태마다 다른 문장 — 준비 안 됨·권한 없음·실패를 '약속 없음'으로 꾸미지 않는다", () => {
    const { rerender } = render(<CareExploreBlock studentId={student} view={view({ state: "unavailable", commitments: [] })} />);
    expect(screen.getByRole("status")).toHaveTextContent("아직 연결되지 않았습니다");
    rerender(<CareExploreBlock studentId={student} view={view({ state: "denied", commitments: [] })} />);
    expect(screen.getByRole("status")).toHaveTextContent("권한이 없습니다");
    rerender(<CareExploreBlock studentId={student} view={view({ state: "error", commitments: [] })} />);
    expect(screen.getByRole("status")).toHaveTextContent("불러오지 못했습니다");
    expect(screen.queryByText("아직 약속이 없습니다.")).toBeNull();
    rerender(<CareExploreBlock studentId={student} view={view({ commitments: [] })} />);
    expect(screen.getByText("아직 약속이 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "약속 관리 열기 ›" })).toHaveAttribute("href", `/students/${student}/care`);
  });

  it("진행 중 약속 — 버전·담당·인수·기준·기록 N건과 두 버튼", () => {
    render(<CareExploreBlock studentId={student} view={view()} />);
    expect(screen.getByText("진행 중 · v2")).toBeInTheDocument();
    expect(screen.getByText(/박지훈 · 수학 · 목표일/)).toHaveTextContent("담당자 인수 확인됨");
    expect(screen.getByText("기록 1건")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "수업보고서" })).toHaveAttribute("href", "/lesson_reports/r1/print");
    expect(screen.getByRole("button", { name: "기록 추가" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "완료 확인" })).toBeEnabled();
  });

  it("완료된 약속은 고정 — 버튼 없이 다음 버전 안내 · 인수 전이면 완료를 잠근다", () => {
    const { rerender } = render(<CareExploreBlock studentId={student} view={view({ commitments: [commitment({ state: "completed", closedOn: "2026-11-04", closedByName: "원장" })] })} />);
    expect(screen.getByText("완료 11.04")).toBeInTheDocument();
    expect(screen.getByText("완료된 약속은 고정 · 새 요구는 v3로")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "기록 추가" })).toBeNull();
    rerender(<CareExploreBlock studentId={student} view={view({ commitments: [commitment({ acknowledged: false })] })} />);
    expect(screen.getByRole("button", { name: "완료 확인" })).toBeDisabled();
    expect(screen.getByText("담당자 인수 확인 뒤 완료할 수 있습니다.")).toBeInTheDocument();
  });

  it("관리 권한이 없으면 완료 버튼이 없고, 쓰기 권한도 없으면 버튼이 하나도 없다", () => {
    const { rerender } = render(<CareExploreBlock studentId={student} view={view({ canManage: false })} />);
    expect(screen.getByRole("button", { name: "기록 추가" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "완료 확인" })).toBeNull();
    rerender(<CareExploreBlock studentId={student} view={view({ canManage: false, canContribute: false })} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("완료 확인 — 사유를 받아 같은 버전으로 저장하고 새로 불러온다", async () => {
    render(<CareExploreBlock studentId={student} view={view()} />);
    fireEvent.click(screen.getByRole("button", { name: "완료 확인" }));
    const reason = await screen.findByLabelText("완료 확인 사유");
    fireEvent.change(reason, { target: { value: "평가 결과 확인" } });
    fireEvent.click(screen.getByRole("button", { name: "완료 처리" }));
    await waitFor(() => expect(m.save).toHaveBeenCalledWith({ studentId: student, id: "c1", version: 3, command: { kind: "complete", reason: "평가 결과 확인" } }));
    await waitFor(() => expect(m.refresh).toHaveBeenCalled());
  });

  it("저장이 거절되면 창 안에 까닭을 보이고 새로 불러오지 않는다", async () => {
    m.save.mockResolvedValue({ ok: false, error: "다른 변경이 있습니다" });
    render(<CareExploreBlock studentId={student} view={view()} />);
    fireEvent.click(screen.getByRole("button", { name: "완료 확인" }));
    fireEvent.change(await screen.findByLabelText("완료 확인 사유"), { target: { value: "확인" } });
    fireEvent.click(screen.getByRole("button", { name: "완료 처리" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("다른 변경"));
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("기록 추가 — 창을 열 때만 후보를 읽고, 실패는 창 안에 알린다", async () => {
    m.options.mockResolvedValue({ ok: false, error: "기록 목록을 불러오지 못했습니다." });
    render(<CareExploreBlock studentId={student} view={view()} />);
    expect(m.options).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "기록 추가" }));
    await waitFor(() => expect(m.options).toHaveBeenCalledWith(student));
    expect(await screen.findByRole("alert")).toHaveTextContent("기록 목록을 불러오지 못했습니다.");
  });
});
