import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { ReplyContext } from "../reply-types";
import { useReplyThread } from "./use-reply-thread";

const mock = vi.hoisted(() => ({ context: vi.fn() }));
vi.mock("../server/reply-actions", () => ({ getParentReplyContext: vi.fn() }));
vi.mock("../server/notification-reply", () => ({ getNotificationReplyContext: mock.context }));

it("알림 원문을 찾은 뒤에도 같은 대상 id로 동작하고 답글 응답이 모호한 공감 숨김을 되돌리지 않는다", async () => {
  const context: ReplyContext = {
    ok: true, message: { id: "m", source: "comment", content: "감사합니다", boardName: null, postedAt: null },
    thread: [], canReply: true, reason: null, authorLabel: "선생님", workerReady: true, maxLength: 1000,
    reaction: null, hideReaction: true,
  };
  mock.context.mockResolvedValue(context);
  const { result } = renderHook(() => useReplyThread(null, false, "notification"));
  await waitFor(() => expect(result.current.ctx?.ok).toBe(true));
  expect(mock.context).toHaveBeenCalledWith("notification");
  await act(async () => {
    await result.current.run(async () => ({ ok: true, message: "요청됨", context: { ...context, hideReaction: undefined } }));
  });
  expect(result.current.ctx).toMatchObject({ message: { id: "m" }, hideReaction: true });
});
