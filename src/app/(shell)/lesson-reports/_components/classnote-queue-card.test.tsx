import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClassnoteQueueCard } from "./classnote-queue-card";
import type { ClassnoteQueueView } from "@/features/report-admin/server/queries";

const { refreshMock, routerRefresh, toastSuccess, toastMessage, toastError, resetStuckMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  routerRefresh: vi.fn(),
  toastSuccess: vi.fn(),
  toastMessage: vi.fn(),
  toastError: vi.fn(),
  resetStuckMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: routerRefresh }) }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess, message: toastMessage, error: toastError } }));
vi.mock("@/features/report-admin/server/actions", () => ({
  refreshClassnoteQueue: refreshMock,
  retryClassnote: vi.fn(),
  resetStuckClassnote: resetStuckMock,
}));
vi.mock("@/features/owner/operations-context", () => ({
  useSubjectMaps: () => ({ labelOf: (k: string) => (k === "math" ? "수학" : k) }),
  useGradeLevels: () => [],
}));

const worker = (online: boolean) => ({
  hostname: "학원동기화-PC",
  lastSeenMinutes: online ? 0 : 12,
  online,
  results: [],
});

const emptySummary = {
  queued: 0,
  processing: 0,
  stuck: 0,
  success: 10,
  failed: 0,
  tooOld: 0,
  nameConflict: 0,
  blockedShared: 0,
  total: 10,
};

/** 진행 중 1건(대기) + 워커 온라인 = 자동 갱신이 도는 기본 상황. */
function waitingView(over: Partial<ClassnoteQueueView> = {}): ClassnoteQueueView {
  return {
    summary: { ...emptySummary, queued: 1, total: 11 },
    items: [],
    pending: [
      {
        id: "r1",
        studentName: "학원이",
        subject: "math",
        reportDate: "2026-07-21",
        status: "queued",
        error: null,
        processingAt: null,
        shareToken: null,
      },
    ],
    workers: [worker(true)],
    since: "2026-07-18",
    days: 3,
    sendEnabled: true,
    ...over,
  };
}

/** 발송이 끝나 큐가 빈 상태. */
function drainedView(over: Partial<ClassnoteQueueView> = {}): ClassnoteQueueView {
  return {
    summary: { ...emptySummary, success: 11, total: 11 },
    items: [],
    pending: [],
    workers: [worker(true)],
    since: "2026-07-18",
    days: 3,
    sendEnabled: true,
    ...over,
  };
}

function setVisibility(value: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("ClassnoteQueueCard 자동 갱신", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refreshMock.mockReset();
    routerRefresh.mockReset();
    toastSuccess.mockReset();
    toastMessage.mockReset();
    toastError.mockReset();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("발송 대기가 남아 있으면 10초마다 다시 조회해 '발송 완료'로 바뀐다", async () => {
    refreshMock.mockResolvedValue(drainedView());
    render(<ClassnoteQueueCard view={waitingView()} />);

    expect(screen.getByText("학원이")).toBeInTheDocument();
    expect(screen.getByText(/자동 갱신 중/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(refreshMock).toHaveBeenCalledWith(3);
    expect(screen.queryByText("학원이")).toBeNull(); // 진행 중 표가 사라짐 = 발송 완료
    expect(toastSuccess).toHaveBeenCalledWith("발송 대기가 모두 처리되었습니다");
    expect(routerRefresh).toHaveBeenCalledTimes(1); // 페이지 나머지 동기화는 딱 한 번
  });

  it("이번 발송에서 실패가 생겼으면 '완료'라고 말하지 않는다", async () => {
    // 1회차: 아직 대기 중(주의 0) → 2회차: 큐는 비었는데 실패 1건이 새로 생김.
    refreshMock
      .mockResolvedValueOnce(waitingView())
      .mockResolvedValueOnce(drainedView({ summary: { ...emptySummary, success: 10, failed: 1, total: 11 } }));
    render(<ClassnoteQueueCard view={waitingView()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastMessage).toHaveBeenCalledWith("발송 대기가 모두 끝났습니다 — 1건은 확인이 필요합니다");
  });

  it("원래 있던 주의 잔여는 완료 알림에서 세지 않는다(매번 경보 금지)", async () => {
    const standing = { ...emptySummary, nameConflict: 2, total: 12 }; // 며칠째 남아 있는 동명이인 2건
    refreshMock
      .mockResolvedValueOnce(waitingView({ summary: { ...standing, queued: 1 } }))
      .mockResolvedValueOnce(drainedView({ summary: standing }));
    render(<ClassnoteQueueCard view={waitingView({ summary: { ...standing, queued: 1 } })} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(toastMessage).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("발송 대기가 모두 처리되었습니다");
  });

  it("다 끝난 뒤에는 더 조회하지 않는다", async () => {
    refreshMock.mockResolvedValue(drainedView());
    render(<ClassnoteQueueCard view={waitingView()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("발송 PC가 꺼져 있으면 1분 간격으로 늦춰서 '켜졌는지'만 지켜본다", async () => {
    refreshMock.mockResolvedValue(waitingView({ workers: [worker(false)] }));
    render(<ClassnoteQueueCard view={waitingView({ workers: [worker(false)] })} />);

    expect(screen.getByText(/발송 PC 꺼짐 — 켜지면 자동으로 이어서 갱신합니다/)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000); // 빠른 주기(10초)였다면 3회 돌았을 시간
    });
    expect(refreshMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("발송 PC가 다시 켜지면 사람이 새로고침하지 않아도 빠른 주기로 이어받는다", async () => {
    refreshMock.mockResolvedValue(waitingView()); // 워커 온라인으로 돌아온 응답
    render(<ClassnoteQueueCard view={waitingView({ workers: [worker(false)] })} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000); // 느린 감시 1회 → 워커 온라인 확인
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/자동 갱신 중\(10초마다\)/)).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000); // 이제 10초 주기
    });
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("화면이 가려진 동안은 건너뛰고, 돌아오면 즉시 한 번 조회한다", async () => {
    refreshMock.mockResolvedValue(waitingView()); // 계속 대기 중
    render(<ClassnoteQueueCard view={waitingView()} />);

    act(() => setVisibility("hidden"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(refreshMock).not.toHaveBeenCalled();

    await act(async () => {
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("서버가 새 값을 내려주면(탭 이동·재발송) 낡은 폴링 스냅샷을 버린다", async () => {
    refreshMock.mockResolvedValue(drainedView());
    const { rerender } = render(<ClassnoteQueueCard view={waitingView()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.queryByText("학원이")).toBeNull(); // 폴링 결과(큐 빔) 반영

    // 그 뒤 다른 선생님이 새로 발송 → 서버 렌더가 새 진행 중을 내려준다.
    const fresh = waitingView();
    fresh.pending[0]!.studentName = "김새로";
    rerender(<ClassnoteQueueCard view={fresh} />);

    expect(screen.getByText("김새로")).toBeInTheDocument(); // 낡은 스냅샷이 가리면 안 됨
  });

  it("10분째 아무 변화가 없으면 멈추고 '다시 확인'을 준다", async () => {
    refreshMock.mockResolvedValue(waitingView()); // 워커는 온라인인데 큐가 전혀 안 줄어드는 상황
    render(<ClassnoteQueueCard view={waitingView()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11 * 60_000);
    });
    const stoppedAt = refreshMock.mock.calls.length;
    expect(screen.getByText(/10분째 변화가 없어 자동 갱신을 멈췄습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 확인" })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000); // 멈춘 뒤엔 더 안 돈다
    });
    expect(refreshMock).toHaveBeenCalledTimes(stoppedAt);
  });

  it("발송이 조금씩이라도 진행되면 10분이 지나도 계속 따라간다(긴 일괄 발송)", async () => {
    // 계속 발송되는 상황 — 남은 건수는 비슷해도 '발송완료'가 폴 때마다 늘어난다(긴 일괄 발송).
    let sent = 10;
    refreshMock.mockImplementation(async () => {
      sent += 1;
      const v = waitingView();
      v.summary.success = sent;
      return v;
    });
    render(<ClassnoteQueueCard view={waitingView()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });

    expect(refreshMock.mock.calls.length).toBeGreaterThan(60); // 상한에 안 걸리고 계속 추적
    expect(screen.getByText(/자동 갱신 중\(10초마다\)/)).toBeInTheDocument();
  });

  it("멈춤복구 직전에 출발한 낡은 응답이 거짓 '완료'를 띄우지 않는다", async () => {
    // 폴 응답을 붙잡아 둔다 — 이 응답에는 방금 재큐잉한 건이 아직 없다(재발송 전 시점의 스냅샷).
    let releasePoll: (v: ClassnoteQueueView) => void = () => {};
    refreshMock.mockImplementation(() => new Promise((resolve) => (releasePoll = resolve)));
    resetStuckMock.mockResolvedValue({ ok: true, reset: 1 });
    const stuckView = waitingView({ summary: { ...emptySummary, queued: 1, stuck: 1, processing: 1, total: 12 } });
    render(<ClassnoteQueueCard view={stuckView} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000); // 폴 출발(응답 대기 중)
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // 그 사이 원장이 '멈춤복구'로 큐를 바꿨다.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /멈춤복구/ }));
      await vi.advanceTimersByTimeAsync(0);
    });

    // 이제 낡은 응답(큐 비어 있음)이 도착 — 반영하면 거짓 완료가 된다.
    await act(async () => {
      releasePoll(drainedView());
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(toastSuccess).not.toHaveBeenCalledWith("발송 대기가 모두 처리되었습니다");
    expect(screen.getByText("학원이")).toBeInTheDocument(); // 진행 중이 사라지지 않는다
  });

  it("조회가 계속 실패하면 '갱신 중'이라고 말하지 않는다", async () => {
    refreshMock.mockRejectedValue(new Error("network"));
    render(<ClassnoteQueueCard view={waitingView()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByText(/갱신에 실패해 다시 시도하는 중입니다/)).toBeInTheDocument();
    expect(screen.getByText("학원이")).toBeInTheDocument(); // 직전 값은 유지(빈 화면 금지)
  });
});
