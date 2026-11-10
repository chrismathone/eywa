import { beforeEach, describe, expect, it, vi } from "vitest";

const { toast } = vi.hoisted(() => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));
vi.mock("sonner", () => ({ toast }));

import { notifyCardQueueResult, notifyRowQueueResult } from "./report-send-notices";

const ctx = (classnoteOn = true) => ({
  classnoteOn,
  lang: "ko" as const,
  t: ((k: string) => k) as never,
  tf: ((k: string) => k) as never,
});

describe("report-send-notices — 카드·표 행 발송 결과 알림(따로)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("카드: 막힌 결과 코드는 그 문구 하나만 띄우고 '대기 중' 성공으로 넘어가지 않는다", () => {
    notifyCardQueueResult({ ok: true, status: "absent" }, "수학", ctx());
    expect(toast.message).toHaveBeenCalledWith("os.c.absentSubject");
    expect(toast.success).not.toHaveBeenCalled();
  });
  it("카드: ClassNote 기능이 꺼진 학원의 dry_run = '저장됨'", () => {
    notifyCardQueueResult({ ok: true, status: "dry_run" }, "수학", ctx(false));
    expect(toast.message).toHaveBeenCalledWith("os.c.savedRecord");
  });
  it("카드: 대기 → 결과 문구 하나(성공) · 영어 그림 경고는 먼저", () => {
    notifyCardQueueResult({ ok: true, status: "queued", warning: "w" }, "수학", ctx());
    expect(toast.message).toHaveBeenCalledWith("w");
    expect(toast.success).toHaveBeenCalledWith("os.c.queueResult");
  });
  it("표 행: 시간창 밖 대기는 창 안내가 붙은 성공 · 회수 중은 오류", () => {
    notifyRowQueueResult({ ok: true, status: "queued", sendWindowHint: "18시" }, { name: "학생" }, "수학", ctx());
    expect(toast.success).toHaveBeenCalledWith("os.c.queuedWindowRow");
    notifyRowQueueResult({ ok: true, status: "recall_pending" }, { name: "학생" }, "수학", ctx());
    expect(toast.error).toHaveBeenCalledWith("os.c.recallingRow");
  });
});
