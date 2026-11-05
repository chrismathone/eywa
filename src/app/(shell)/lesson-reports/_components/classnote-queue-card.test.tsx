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

const worker = (online: boolean, nativePublish = true) => ({
  hostname: "학원동기화-PC",
  lastSeenMinutes: online ? 0 : 12,
  online,
  results: [], env: { logDir: null, recent: [] },
  nativePublish,
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
    nowMs: Date.parse("2026-07-22T12:00:00+09:00"),
    sendEnabled: true,
    expiredUnsent: 0,
    todayKst: "2026-07-22",
    unsentSendable: 0,
    unsentOldestDate: null,
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
    nowMs: Date.parse("2026-07-22T12:00:00+09:00"),
    sendEnabled: true,
    expiredUnsent: 0,
    todayKst: "2026-07-22",
    unsentSendable: 0,
    unsentOldestDate: null,
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
    render(<ClassnoteQueueCard canSend view={waitingView()} />);

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
    render(<ClassnoteQueueCard canSend view={waitingView()} />);

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
    render(<ClassnoteQueueCard canSend view={waitingView({ summary: { ...standing, queued: 1 } })} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(toastMessage).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith("발송 대기가 모두 처리되었습니다");
  });

  it("다 끝난 뒤에는 더 조회하지 않는다", async () => {
    refreshMock.mockResolvedValue(drainedView());
    render(<ClassnoteQueueCard canSend view={waitingView()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("발송 PC가 꺼져 있으면 1분 간격으로 늦춰서 '켜졌는지'만 지켜본다", async () => {
    refreshMock.mockResolvedValue(waitingView({ workers: [worker(false)] }));
    render(<ClassnoteQueueCard canSend view={waitingView({ workers: [worker(false)] })} />);

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
    render(<ClassnoteQueueCard canSend view={waitingView({ workers: [worker(false)] })} />);

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
    render(<ClassnoteQueueCard canSend view={waitingView()} />);

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
    const { rerender } = render(<ClassnoteQueueCard canSend view={waitingView()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.queryByText("학원이")).toBeNull(); // 폴링 결과(큐 빔) 반영

    // 그 뒤 다른 선생님이 새로 발송 → 서버 렌더가 새 진행 중을 내려준다.
    const fresh = waitingView();
    fresh.pending[0]!.studentName = "김새로";
    rerender(<ClassnoteQueueCard canSend view={fresh} />);

    expect(screen.getByText("김새로")).toBeInTheDocument(); // 낡은 스냅샷이 가리면 안 됨
  });

  it("10분째 아무 변화가 없으면 멈추고 '다시 확인'을 준다", async () => {
    refreshMock.mockResolvedValue(waitingView()); // 워커는 온라인인데 큐가 전혀 안 줄어드는 상황
    render(<ClassnoteQueueCard canSend view={waitingView()} />);

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
    render(<ClassnoteQueueCard canSend view={waitingView()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });

    expect(refreshMock.mock.calls.length).toBeGreaterThan(60); // 상한에 안 걸리고 계속 추적
    expect(screen.getByText(/자동 갱신 중\(10초마다\)/)).toBeInTheDocument();
  });

  it("멈춤 재시도 직전에 출발한 낡은 응답이 거짓 '완료'를 띄우지 않는다", async () => {
    // 폴 응답을 붙잡아 둔다 — 이 응답에는 방금 재큐잉한 건이 아직 없다(재발송 전 시점의 스냅샷).
    let releasePoll: (v: ClassnoteQueueView) => void = () => {};
    refreshMock.mockImplementation(() => new Promise((resolve) => (releasePoll = resolve)));
    resetStuckMock.mockResolvedValue({ ok: true, reset: 1 });
    const stuckView = waitingView({ summary: { ...emptySummary, queued: 1, stuck: 1, processing: 1, total: 12 } });
    render(<ClassnoteQueueCard canSend view={stuckView} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000); // 폴 출발(응답 대기 중)
    });
    expect(refreshMock).toHaveBeenCalledTimes(1);

    // 그 사이 원장이 '멈춤 재시도'로 큐를 바꿨다.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /멈춤 재시도/ }));
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

  it("첫 조회에서 바로 실패로 끝나도 '모두 처리'라고 말하지 않는다", async () => {
    // 감시 시작 시점 주의 0 → 첫 폴에서 큐가 비었는데 실패 1건. 시드가 없으면 성공 토스트가 뜬다.
    refreshMock.mockResolvedValue(
      drainedView({ summary: { ...emptySummary, success: 10, failed: 1, total: 11 } }),
    );
    render(<ClassnoteQueueCard canSend view={waitingView()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastMessage).toHaveBeenCalledWith("발송 대기가 모두 끝났습니다 — 1건은 확인이 필요합니다");
  });

  it("가려 둔 시간은 '무변화' 시간으로 세지 않는다 — 돌아오면 멈추지 말고 확인한다", async () => {
    refreshMock.mockResolvedValue(waitingView()); // 변화 없음
    render(<ClassnoteQueueCard canSend view={waitingView()} />);

    act(() => setVisibility("hidden"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20 * 60_000); // 20분간 안 봄
    });
    expect(refreshMock).not.toHaveBeenCalled();

    await act(async () => {
      setVisibility("visible");
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(refreshMock).toHaveBeenCalledTimes(1); // 멈춤 대신 조회
    expect(screen.queryByText(/자동 갱신을 멈췄습니다/)).toBeNull();
  });

  it("주의 목록에서 사라진 행의 체크는 자동으로 풀린다", async () => {
    const withItems = waitingView({
      items: [
        { id: "a1", studentName: "실패학생", subject: "math", reportDate: "2026-07-21", status: "failed", error: null, processingAt: null, shareToken: null },
      ],
      summary: { ...emptySummary, queued: 1, failed: 1, total: 12 },
    });
    refreshMock.mockResolvedValue(waitingView()); // 다음 조회에선 그 행이 사라짐(해결됨)
    render(<ClassnoteQueueCard canSend view={withItems} />);

    fireEvent.click(screen.getByRole("checkbox", { name: "실패학생 선택" }));
    expect(screen.getByRole("button", { name: /선택 재발송 \(1\)/ })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(screen.getByRole("button", { name: /^선택 재발송/ })).toBeDisabled(); // 남은 체크 0 → 비활성
  });

  it("조회가 계속 실패하면 '갱신 중'이라고 말하지 않는다", async () => {
    refreshMock.mockRejectedValue(new Error("network"));
    render(<ClassnoteQueueCard canSend view={waitingView()} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(screen.getByText(/갱신에 실패해 다시 시도하는 중입니다/)).toBeInTheDocument();
    expect(screen.getByText("학원이")).toBeInTheDocument(); // 직전 값은 유지(빈 화면 금지)
  });
});

// 🔴 2026-08-11 원장 제보("어제는 미발송분이 있었는데 날이 바뀌니 사라졌다")로 추가된 계약.
//    실패는 3일 창 밖으로 밀려도 **아직 기한이 남았으면** 카드에 남아야 하고, 남은 날이 보여야 한다.
describe("재발송 기한 표시", () => {
  const failedItem = (id: string, reportDate: string) => ({
    id,
    studentName: id,
    subject: "math",
    reportDate,
    status: "failed",
    error: "ClassNote 보드에 연결된 원아가 없습니다",
    processingAt: null,
    shareToken: null,
  });
  // todayKst 2026-07-22 → 발송 창 07-16~07-22. 07-16=오늘이 마지막 날 / 07-10=이미 만료.
  const view = () =>
    drainedView({
      summary: { ...emptySummary, failed: 2, total: 12 },
      items: [failedItem("r-today", "2026-07-16"), failedItem("r-old", "2026-07-10")],
      expiredUnsent: 5,
    });

  it("마지막 날은 '오늘까지', 기한 지난 건은 '기한 만료'로 표시한다", () => {
    render(<ClassnoteQueueCard canSend view={view()} />);
    expect(screen.getByText("오늘까지")).toBeInTheDocument();
    expect(screen.getByText("기한 만료")).toBeInTheDocument();
  });

  it("만료건은 '주의 항목 전체 재발송' 대상에서 빠진다 — 눌러도 서버가 거부해 헛돌기 때문", () => {
    render(<ClassnoteQueueCard canSend view={view()} />);
    expect(screen.getByRole("button", { name: /주의 항목 전체 재발송 \(1\)/ })).toBeInTheDocument();
  });

  it("만료건도 개별 선택은 열어 둔다 — 화면이 길을 막지 않는다(최종 판단은 서버)", () => {
    render(<ClassnoteQueueCard canSend view={view()} />);
    expect(screen.getByLabelText("r-old 선택")).not.toBeDisabled();
  });

  it("기한을 넘겨 못 나간 건수를 경고로 알린다", () => {
    render(<ClassnoteQueueCard canSend view={view()} />);
    expect(screen.getByText(/재발송 기한\(7일\)을 넘겨/)).toBeInTheDocument();
  });

  // #89 — 상한에 걸려 잘린 목록을 말없이 두면 "보이는 게 전부"로 읽힌다.
  it("주의 목록이 상한에 걸려 잘리면 잘린 수를 밝힌다", () => {
    render(
      <ClassnoteQueueCard
        canSend
        view={drainedView({
          summary: { ...emptySummary, failed: 5, total: 15 },
          items: [failedItem("r-1", "2026-07-20")],
        })}
      />,
    );
    expect(screen.getByText(/주의 5건 중 1건만 표시했습니다/)).toBeInTheDocument();
  });

  it("잘리지 않았으면 안내를 띄우지 않는다", () => {
    render(
      <ClassnoteQueueCard
        canSend
        view={drainedView({ summary: { ...emptySummary, failed: 1, total: 11 }, items: [failedItem("r-1", "2026-07-20")] })}
      />,
    );
    expect(screen.queryByText(/건만 표시했습니다/)).toBeNull();
  });

  it("잃은 건이 없으면 경고를 띄우지 않는다", () => {
    render(<ClassnoteQueueCard canSend view={drainedView()} />);
    expect(screen.queryByText(/재발송 기한\(7일\)을 넘겨/)).toBeNull();
  });

  // 원장 2026-11-05 — 읽기 권한에 재발송 단추가 떠서 눌러야 "권한이 없습니다"가 떴다. 단추·선택 칸을 아예 그리지 않는다.
  it("읽기 권한(canSend=false)이면 재발송·선택 칸을 그리지 않고 주의 목록은 그대로 보인다", () => {
    render(<ClassnoteQueueCard canSend={false} view={view()} />);
    expect(screen.queryByRole("button", { name: /재발송/ })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("r-old")).toBeInTheDocument();
  });
});

describe("구워커 경고", () => {
  it("nativePublish=false면 업데이트 필요 경고를 띄운다 — 옛 서버 소등 시 발송 전멸을 미리 알린다", () => {
    render(<ClassnoteQueueCard canSend view={drainedView({ workers: [worker(true, false)] })} />);
    expect(screen.getByText(/구버전 워커/)).toBeInTheDocument();
  });

  it("최신 워커면 경고가 없다", () => {
    render(<ClassnoteQueueCard canSend view={drainedView()} />);
    expect(screen.queryByText(/구버전 워커/)).toBeNull();
  });
});
