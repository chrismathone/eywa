import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UnpushedIntakeConsultation } from "@/features/integrations/server/makeedu-sync";
import { MakeeduPushButton } from "./makeedu-push-button";

/**
 * 콜&상담 머리글 'makeedu 보내기'(원장 2026-10-01) — 배지 = 지금 보낼 수 있는 건수 · 누르면 연동 면과 **같은 카드**가
 * 다이얼로그로 · 보낸 뒤 서버 재검증이 내려 준 새 후보로 목록·배지가 바뀐다(다이얼로그는 열린 채).
 * 전송 서버 액션은 껍데기로 바꾼다 — 여기서 보는 건 연결과 표시다(게이트는 makeedu-push-access.test.ts).
 */
const enqueue = vi.hoisted(() => vi.fn());
vi.mock("@/features/integrations/server/actions", () => ({ enqueueConsultationPush: enqueue }));

const row = (id: string, name: string, pushStatus: string | null = null): UnpushedIntakeConsultation => ({
  id,
  prospectName: name,
  prospectSchool: "경명여중",
  prospectGrade: "중1",
  parentName: "보호자",
  parentPhone: null,
  subject: "math",
  consultationPath: "QR",
  createdAt: "2026-09-28T03:00:00.000Z",
  outcome: "pending",
  pushStatus,
  pushError: null,
  note: null,
});

afterEach(cleanup);
beforeEach(() => {
  enqueue.mockReset();
  enqueue.mockResolvedValue({ ok: true, message: "1건을 makeedu 전송 대기열에 넣었습니다" });
});

describe("makeedu 보내기 버튼", () => {
  it("조회 중(대체 화면)엔 같은 자리의 잠긴 버튼 — 배지 없음", () => {
    render(<MakeeduPushButton candidates={null} />);
    const btn = screen.getByRole("button", { name: "makeedu 보내기" });
    expect(btn).toBeDisabled();
    expect(btn.textContent).toBe("makeedu 보내기");
  });

  it("배지 = 지금 보낼 수 있는 건수(대기·제출 중 제외, 실패는 포함)", () => {
    render(
      <MakeeduPushButton
        candidates={[row("a", "가"), row("b", "나", "error"), row("c", "다", "pending"), row("d", "라", "running")]}
      />,
    );
    const btn = screen.getByRole("button", { name: "makeedu 보내기 — 보낼 상담 2건" });
    expect(btn).toBeEnabled();
    expect(btn.textContent).toBe("makeedu 보내기2");
  });

  it("보낼 건이 없으면 배지 없이 열린다 — 카드의 빈 상태", () => {
    render(<MakeeduPushButton candidates={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "makeedu 보내기" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/지금 makeedu로 보낼 새 QR 접수 상담이 없습니다/)).toBeInTheDocument();
  });

  it("누르면 연동 면과 같은 카드가 다이얼로그로 — 매주 일요일 자동 안내 포함", () => {
    render(<MakeeduPushButton candidates={[row("a", "가나다")]} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /makeedu 보내기/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "makeedu로 상담 보내기 (역동기화)" })).toBeInTheDocument();
    expect(within(dialog).getByText(/매주 일요일 06:00에 남은 건을 자동으로도 보냅니다/)).toBeInTheDocument();
    expect(within(dialog).getByText("가나다")).toBeInTheDocument();
  });

  it("골라 보내면 기존 전송 액션을 그 id로 부르고, 재검증된 후보가 오면 목록·배지가 바뀐다", async () => {
    const { rerender } = render(<MakeeduPushButton candidates={[row("a", "가"), row("b", "나")]} />);
    fireEvent.click(screen.getByRole("button", { name: "makeedu 보내기 — 보낼 상담 2건" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "가 선택" }));
    fireEvent.click(within(dialog).getByRole("button", { name: /makeedu로 보내기/ }));
    await waitFor(() => expect(enqueue).toHaveBeenCalledWith(["a"]));
    expect(await within(dialog).findByText(/전송 대기열에 넣었습니다/)).toBeInTheDocument();

    // 서버 재검증(revalidatePath("/enrollment"))이 내려 준 새 후보 — 보낸 건은 '전송 대기'로 잠긴다.
    rerender(<MakeeduPushButton candidates={[row("a", "가", "pending"), row("b", "나")]} />);
    const reopened = screen.getByRole("dialog");
    expect(within(reopened).getByRole("checkbox", { name: "가 선택" })).toBeDisabled();
    expect(within(reopened).getByText("전송 대기")).toBeInTheDocument();
    // 머리글 버튼은 모달 뒤(aria-hidden)라 hidden까지 찾는다 — 배지가 2 → 1로.
    expect(screen.getByRole("button", { name: "makeedu 보내기 — 보낼 상담 1건", hidden: true })).toBeInTheDocument();
  });
});
