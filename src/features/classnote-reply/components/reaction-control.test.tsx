import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactionView } from "../reply-types";
import { ReactionControl } from "./reaction-control";

const actions = vi.hoisted(() => ({
  requestParentReaction: vi.fn(),
  requestParentReactionRemove: vi.fn(),
  getParentReactionState: vi.fn(),
}));
vi.mock("../server/reaction-actions", () => actions);

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const base: ReactionView = {
  messageId: "m1", typeLabel: null, statusLabel: null, tone: "inert", pressed: false, busy: false, by: null, error: null, errorRaw: null, canPress: true, canRemove: false,
};
const pressed: ReactionView = { ...base, typeLabel: "확인했어요", statusLabel: "공감함", tone: "positive", pressed: true, by: "BS3Q 수진T", canPress: false, canRemove: true };

describe("공감 조작", () => {
  it("공감 기능이 없는 자리(view 없음)는 아무것도 그리지 않는다", () => {
    const { container } = render(<ReactionControl view={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("'공감'을 누르면 종류 여섯 개가 한글로 펼쳐지고, 고르면 그 종류로 요청한다", async () => {
    actions.requestParentReaction.mockResolvedValue({ ok: true, message: "요청했습니다", reaction: { ...base, typeLabel: "확인했어요", statusLabel: "공감 누르는 중", busy: true, canPress: false } });
    render(<ReactionControl view={base} />);
    expect(screen.queryByRole("button", { name: "확인했어요" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "공감" }));
    for (const label of ["좋아요", "감사해요", "확인했어요", "기쁨", "놀람", "슬픔"]) expect(screen.getByRole("button", { name: label })).toBeVisible();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "확인했어요" })); });
    expect(actions.requestParentReaction).toHaveBeenCalledWith({ messageId: "m1", type: "check" });
    // 처리 중에는 버튼이 없다(재클릭 방어) — 상태만 보인다.
    expect(screen.getByRole("status")).toHaveTextContent("공감 누르는 중");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("눌려 있고 풀 수 있으면 누른 종류가 보이고, 누르면 풀기를 요청한다", async () => {
    actions.requestParentReactionRemove.mockResolvedValue({ ok: true, message: "풀기 요청", reaction: { ...pressed, statusLabel: "공감 푸는 중", busy: true, canRemove: false } });
    render(<ReactionControl view={pressed} />);
    const btn = screen.getByRole("button", { name: "확인했어요 · 공감함" });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await act(async () => { fireEvent.click(btn); });
    expect(actions.requestParentReactionRemove).toHaveBeenCalledWith({ messageId: "m1" });
    expect(screen.getByRole("status")).toHaveTextContent("공감 푸는 중");
  });

  it("남이 누른 공감은 풀 버튼 없이 상태만 보인다 · 누를 수 없는 사람에겐 '공감' 버튼이 없다", () => {
    render(<ReactionControl view={{ ...pressed, canRemove: false }} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("확인했어요 · 공감함")).toBeVisible();
    cleanup();
    const { container } = render(<ReactionControl view={{ ...base, canPress: false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("서버가 거절하면 한글 사유를 보이고, 서버가 준 상태로 바뀐다", async () => {
    actions.requestParentReaction.mockResolvedValue({ ok: false, error: "이미 공감한 글입니다(BS3Q 민아T)", reaction: { ...pressed, by: "BS3Q 민아T", canRemove: false } });
    render(<ReactionControl view={base} />);
    fireEvent.click(screen.getByRole("button", { name: "공감" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "좋아요" })); });
    expect(screen.getByText("이미 공감한 글입니다(BS3Q 민아T)")).toBeVisible();
    expect(screen.getByText("확인했어요 · 공감함")).toBeVisible();
  });

  it("못 누른 기록은 사유(원문은 툴팁)와 함께 다시 누를 수 있다", () => {
    render(<ReactionControl view={{ ...base, statusLabel: "공감하지 못함", tone: "critical", error: "ClassNote가 요청을 거부했습니다", errorRaw: "HTTP 400" }} />);
    const reason = screen.getByText("ClassNote가 요청을 거부했습니다");
    expect(reason).toHaveAttribute("title", "HTTP 400");
    expect(screen.getByRole("button", { name: "공감" })).toBeVisible();
  });
});
