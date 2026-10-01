import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReplyContext, ReplyView, ThreadEntry } from "../reply-types";
import { BELL_ANCHOR_ATTR, overlayPos, ParentReplyOverlay } from "./parent-reply-overlay";

const actions = vi.hoisted(() => ({
  getNotificationReplyContext: vi.fn(),
  getParentReplyContext: vi.fn(),
  requestParentReply: vi.fn(),
  requestParentReplyDelete: vi.fn(),
  requestParentReplyEdit: vi.fn(),
}));
vi.mock("../server/reply-actions", () => actions);
vi.mock("../server/notification-reply", () => ({ getNotificationReplyContext: actions.getNotificationReplyContext }));
vi.mock("../server/reaction-actions", () => ({ requestParentReaction: vi.fn(), requestParentReactionRemove: vi.fn(), getParentReactionState: vi.fn() }));
vi.mock("@/features/students/components/homework-video-player", () => ({ HomeworkVideoPlayer: ({ preview }: { preview: string }) => <iframe title="영상" src={preview} /> }));

const reply = (id: string, over: Partial<ReplyView> = {}): ReplyView => ({
  id, authorLabel: "BS3Q 수진T", body: `답글 ${id}`, pendingBody: null, statusLabel: "올림", tone: "positive", busy: false, error: null, errorRaw: null,
  canChange: true, notPosted: false, mine: true, createdAt: "2026-10-01T02:00:00Z", editedAt: null, historyCount: 0, ...over,
});

const playable = { id: "v1", playable: true, pending: false, label: "영상 보기", uploadedAt: null, links: { preview: "about:blank#/preview", thumbnail: "t", view: null } };
const thread: ThreadEntry[] = [
  { kind: "parent", messageId: "p", source: "post", content: "[영상] (내용 없이 첨부만)", postedAt: "2026-10-01T01:00:00Z", focus: true, videos: [playable], photos: [], mediaNote: null },
  { kind: "reply", reply: reply("r1"), messageId: "p" },
  { kind: "parent", messageId: "c", source: "comment", content: "[영상] (내용 없이 첨부만)", postedAt: "2026-10-01T03:00:00Z", focus: false, videos: [{ ...playable, id: "v2", playable: false, pending: true, label: "영상을 보관하는 중입니다. 잠시 후 재생할 수 있습니다.", links: null }], photos: [], mediaNote: null },
];
const ctx = (over: Partial<Extract<ReplyContext, { ok: true }>> = {}): ReplyContext => ({
  ok: true, message: { id: "p", source: "post", content: "[영상] (내용 없이 첨부만)", boardName: "(수학)홍", postedAt: "2026-10-01T01:00:00Z" },
  thread, canReply: true, reason: null, authorLabel: "BS3Q 수진T", workerReady: true, maxLength: 500, reaction: null, ...over,
});

beforeEach(() => {
  actions.getParentReplyContext.mockResolvedValue(ctx());
  // 벨 단추 자리 — 오버레이는 이 단추 아래·오른쪽 끝에 맞춘다.
  const bell = document.createElement("button");
  bell.setAttribute(BELL_ANCHOR_ATTR, "bell-a");
  bell.getBoundingClientRect = () => ({ top: 8, bottom: 44, left: 900, right: 936, width: 36, height: 36, x: 900, y: 8, toJSON: () => ({}) });
  document.body.appendChild(bell);
  Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true });
});
afterEach(() => { cleanup(); document.body.innerHTML = ""; vi.clearAllMocks(); });

describe("벨 답글 오버레이", () => {
  it("벨 단추 아래(목록이 열리던 자리)에 오른쪽 끝을 맞춰 겹쳐 뜬다 — 화면 가운데 다이얼로그가 아니다", async () => {
    await act(async () => { render(<ParentReplyOverlay messageId="p" anchorId="bell-a" onClose={() => {}} />); });
    const panel = document.querySelector("[data-reply-overlay]") as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.parentElement).toBe(document.body); // 포털 — 어떤 카드의 overflow에도 잘리지 않는다
    expect(panel.style.top).toBe("50px"); // 벨 bottom 44 + 6
    expect(panel.style.left).toBe("496px"); // 벨 right 936 - 폭 440 = 오른쪽 끝 맞춤
    expect(panel.style.width).toBe("440px");
    expect(panel.className).toContain("fixed");
    expect(panel.className).not.toContain("top-1/2"); // 가운데 정렬 아님
  });

  it("데스크톱 벨(사이드바 맨 아래 왼쪽)이면 벨 **위로**, 화면 안으로 당겨 연다 — 아래로 열면 화면 밖으로 나간다", () => {
    const p = overlayPos({ top: 840, bottom: 876, right: 236 }, 1600, 900);
    expect(p.top).toBeUndefined();
    expect(p.bottom).toBe(900 - 840 + 6); // 벨 위 6px에 바닥을 붙인다
    expect(p.left).toBe(12); // 236 - 440 < 0 → 왼쪽 여백까지만
    expect(p.maxHeight).toBeLessThanOrEqual(840 - 6 - 12);
    // 좁은 폰(360px) — 폭이 화면을 넘지 않는다.
    const phone = overlayPos({ top: 8, bottom: 52, right: 300 }, 360, 700);
    expect(phone.width).toBe(336);
    expect(phone.left).toBe(12);
    expect(phone.top).toBe(58);
  });

  it("화면에 벨이 둘이면(숨은 벨 포함) 이 창을 연 그 벨에 붙는다", async () => {
    const other = document.createElement("button");
    other.setAttribute(BELL_ANCHOR_ATTR, "bell-b");
    other.getBoundingClientRect = () => ({ top: 700, bottom: 736, left: 100, right: 136, width: 36, height: 36, x: 100, y: 700, toJSON: () => ({}) });
    document.body.insertBefore(other, document.body.firstChild);
    await act(async () => { render(<ParentReplyOverlay messageId="p" anchorId="bell-a" onClose={() => {}} />); });
    expect((document.querySelector("[data-reply-overlay]") as HTMLElement).style.top).toBe("50px"); // bell-b(아래쪽)가 아니라 bell-a 아래
  });

  it("쓰레드 — 학부모 글 → 우리 답글 → 학부모 댓글을 시간순으로 · 답글은 수정·삭제를 그대로 · 보관 중 영상은 안내 문구", async () => {
    await act(async () => { render(<ParentReplyOverlay messageId="p" onClose={() => {}} />); });
    const items = screen.getByLabelText("이 글의 쓰레드").children;
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("학부모 글");
    expect(items[0]).toHaveTextContent("답글 대상");
    expect(items[1]).toHaveTextContent("답글 r1");
    expect(items[2]).toHaveTextContent("학부모 댓글");
    expect(screen.getByRole("button", { name: "수정" })).toBeVisible();
    expect(screen.getByRole("button", { name: "삭제" })).toBeVisible();
    expect(screen.getByRole("status", { name: "" }).textContent).toMatch(/영상을 보관하는 중입니다/);
  });

  it("보관이 끝난 영상은 썸네일 칸(▶) → iframe 팝업으로 바로 재생 · 사진은 작은 칸 → 누르면 크게(no-referrer)", async () => {
    const photo = { small: "https://up-kids-kage.kakao.com/dn/a/img_s.jpg", large: "https://up-kids-kage.kakao.com/dn/a/img_l.jpg", width: 800, height: 600 };
    actions.getParentReplyContext.mockResolvedValue(ctx({ thread: [{ ...(thread[0] as Extract<ThreadEntry, { kind: "parent" }>), photos: [photo, photo] }, thread[1]!, thread[2]!] }));
    await act(async () => { render(<ParentReplyOverlay messageId="p" onClose={() => {}} />); });
    const tiles = screen.getByLabelText("학부모 글 첨부").children;
    expect(tiles).toHaveLength(3); // 영상 1 + 사진 2 — 한 줄
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "사진 2 크게 보기" })); });
    const big = await screen.findByAltText("학부모 글 사진 2");
    expect(big.getAttribute("src")).toBe(photo.large);
    expect(big.getAttribute("referrerpolicy")).toBe("no-referrer");
  });

  it("보관이 끝난 영상은 '영상 1 재생' → iframe 팝업", async () => {
    await act(async () => { render(<ParentReplyOverlay messageId="p" onClose={() => {}} />); });
    expect(document.querySelector("iframe")).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "영상 1 재생" })); });
    const frame = await screen.findByTitle("영상");
    expect(frame.getAttribute("src")).toContain("/preview");
  });

  it("Esc·'← 알림 목록' = 목록으로 돌아감(back) · 바깥 클릭 = 그냥 닫음(dismiss) · 안쪽 클릭은 닫지 않는다", async () => {
    const onClose = vi.fn();
    await act(async () => { render(<ParentReplyOverlay messageId="p" onClose={onClose} />); });
    fireEvent.pointerDown(screen.getByLabelText("이 글의 쓰레드"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenLastCalledWith("back");
    fireEvent.click(screen.getByRole("button", { name: "← 알림 목록" }));
    expect(onClose).toHaveBeenLastCalledWith("back");
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenLastCalledWith("dismiss");
  });

  it("영상 팝업(다른 대화상자)이 떠 있는 동안에는 바깥 클릭·Esc가 오버레이를 닫지 않는다", async () => {
    const onClose = vi.fn();
    await act(async () => { render(<ParentReplyOverlay messageId="p" onClose={onClose} />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "영상 1 재생" })); });
    await screen.findByTitle("영상");
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("벨이 다시 그려져도(새 onClose) 쓰던 입력칸의 포커스를 빼앗지 않는다 · 쓰던 답글이 있으면 바깥 클릭·Esc로 닫히지 않는다", async () => {
    const first = vi.fn();
    const { rerender } = await (async () => {
      let r!: ReturnType<typeof render>;
      await act(async () => { r = render(<ParentReplyOverlay messageId="p" onClose={first} />); });
      return r;
    })();
    await act(async () => { await new Promise((res) => requestAnimationFrame(() => res(null))); });
    const box = screen.getByLabelText("답글 내용") as HTMLTextAreaElement;
    box.focus();
    fireEvent.change(box, { target: { value: "네 확인했습니다" } });
    const second = vi.fn();
    await act(async () => { rerender(<ParentReplyOverlay messageId="p" onClose={second} />); });
    await act(async () => { await new Promise((res) => requestAnimationFrame(() => res(null))); });
    expect(document.activeElement).toBe(box);
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    // '← 알림 목록'은 쓰던 답글이 있으면 한 번 묻는다 — '계속 쓰기'면 그대로, '돌아가기'면 최신 콜백으로 닫힌다.
    fireEvent.click(screen.getByRole("button", { name: "← 알림 목록" }));
    expect(second).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "계속 쓰기" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(second).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "← 알림 목록" }));
    fireEvent.click(screen.getByRole("button", { name: "돌아가기" }));
    expect(second).toHaveBeenLastCalledWith("back");
    expect(first).not.toHaveBeenCalled();
  });

  it("창 모드의 플로팅 창(늘 role=dialog)이 떠 있어도 바깥 클릭·Esc로 닫힌다 — 모달 대화상자만 막는다", async () => {
    const win = document.createElement("div");
    win.setAttribute("role", "dialog");
    win.setAttribute("data-window-dialog", "");
    win.setAttribute("aria-modal", "false");
    document.body.appendChild(win);
    const onClose = vi.fn();
    await act(async () => { render(<ParentReplyOverlay messageId="p" onClose={onClose} />); });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenLastCalledWith("back");
    fireEvent.pointerDown(win);
    expect(onClose).toHaveBeenLastCalledWith("dismiss");
  });

  it("플로팅 창(iframe) 안을 누르면(이 문서가 포커스를 잃고 iframe이 활성) 닫힌다 · 탭 전환(활성 요소 그대로)은 닫지 않는다", async () => {
    const onClose = vi.fn();
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    await act(async () => { render(<ParentReplyOverlay messageId="p" onClose={onClose} />); });
    await act(async () => { window.dispatchEvent(new Event("blur")); await new Promise((r) => setTimeout(r, 5)); });
    expect(onClose).not.toHaveBeenCalled();
    const active = vi.spyOn(document, "activeElement", "get").mockReturnValue(frame);
    await act(async () => { window.dispatchEvent(new Event("blur")); await new Promise((r) => setTimeout(r, 5)); });
    expect(onClose).toHaveBeenLastCalledWith("dismiss");
    active.mockRestore();
  });

  it("알림 id로 직접 연 창에도 같은 쓰레드·답글 입력과 담임 전용 이동이 있다", async () => {
    actions.getNotificationReplyContext.mockResolvedValue(ctx({ classnoteUrl: "https://www.classnote.com/service/report/123" }));
    await act(async () => { render(<ParentReplyOverlay notificationId="n" onClose={() => {}} />); });
    expect(actions.getNotificationReplyContext).toHaveBeenCalledWith("n");
    expect(screen.getByRole("list", { name: "이 글의 쓰레드" })).toBeVisible();
    expect(screen.getByPlaceholderText("학부모님께 보낼 답글")).toBeVisible();
    const link = screen.getByRole("link", { name: "ClassNote 이동 ↗" });
    expect(link).toHaveAttribute("href", "https://www.classnote.com/service/report/123");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("서버에서 담임 주소를 주지 않으면 답글이 가능해도 이동 버튼은 없다", async () => {
    await act(async () => { render(<ParentReplyOverlay messageId="p" onClose={() => {}} />); });
    expect(screen.getByPlaceholderText("학부모님께 보낼 답글")).toBeVisible();
    expect(screen.queryByRole("link", { name: "ClassNote 이동 ↗" })).toBeNull();
  });

  it("답글 자격이 없으면 입력 대신 사유 — 쓰레드는 그대로 읽힌다", async () => {
    actions.getParentReplyContext.mockResolvedValue(ctx({ canReply: false, reason: "이 학생을 지금 맡고 있는 선생님과 관리자만 답글을 쓸 수 있습니다", authorLabel: null }));
    await act(async () => { render(<ParentReplyOverlay messageId="p" onClose={() => {}} />); });
    expect(screen.getByText(/지금 맡고 있는 선생님과 관리자만/)).toBeVisible();
    expect(screen.queryByLabelText(/답글/, { selector: "textarea" })).toBeNull();
  });
});
