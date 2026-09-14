import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitSeatJjEdits, setSeatJjField } from "@/features/attendance/seat/server/mark-actions";
import { useSeatBoardSaves } from "./seat-board-saves";

// 자리판 JJ 칸 감사로그(원장 결정 2026-09-14) — 언마운트 경로를 잠근다(리뷰 2026-09-14).
// Safari·iPad는 화면이 사라질 때 blur가 오지 않아 **언마운트가 유일한 기록 기회**다. 그때 정리 코드가 대기 저장을
// 먼저 실행해 버리면 감사로그의 flush가 기다릴 것이 없어, 서버가 저장 도착 전 DB를 읽고 줄을 흘렸다.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/features/attendance/seat/server/actions", () => ({
  setSeatCell: vi.fn(),
  fillSeatSlot: vi.fn(),
  fillSeatPrevAbsent: vi.fn(),
}));
vi.mock("@/features/attendance/seat/server/mark-actions", () => ({
  setSeatJjField: vi.fn(),
  commitSeatJjEdits: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/features/class-sheets/server/edit-audit-actions", () => ({ commitSheetEdits: vi.fn() }));

afterEach(() => vi.clearAllMocks());

/** 여러 단계의 마이크로태스크(flush → allSettled → 전송)를 흘려보낸다. */
const drain = () =>
  act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });

describe("자리판 JJ 칸 감사로그 — 언마운트", () => {
  it("🔴 칸을 친 채 화면이 사라져도(blur 없음) 기록은 저장이 도착한 뒤에 나간다", async () => {
    let finishSave: (v: { ok: true }) => void = () => {};
    vi.mocked(setSeatJjField).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        }),
    );

    const { result, unmount } = renderHook(() => useSeatBoardSaves("jj", "2026-09-14", "17:20"));
    act(() => result.current.saveField("c1", "s1", "listeningLevel", "4", "3"));
    unmount(); // 디바운스 타이머가 발화하기 전에 화면이 사라진다

    await drain();
    expect(setSeatJjField).toHaveBeenCalledTimes(1); // 정리 코드가 대기 저장을 실행했다(응답 대기)
    expect(commitSeatJjEdits).not.toHaveBeenCalled(); // 🔴 저장 도착 전엔 기록을 보내지 않는다

    finishSave({ ok: true });
    await drain();
    expect(commitSeatJjEdits).toHaveBeenCalledTimes(1);
    expect(vi.mocked(commitSeatJjEdits).mock.calls[0]![0]).toMatchObject({
      seat: "jj",
      date: "2026-09-14",
      slotStart: "17:20",
      edits: [
        { cell: { kind: "seatJj", classId: "c1", studentId: "s1", field: "listeningLevel" }, before: "3" },
      ],
    });
  });
});
